
const fs = require('fs');
const request = require('request');

const NB_PROJECTS_PER_PAGE = 25;
const CONFIG_FILE = 'config.json';

class Redmine {

  constructor(config) {
    let redmineUrl = config.redmineUrl;
    if (redmineUrl && redmineUrl.endsWith('/')) {
      redmineUrl = redmineUrl.substr(0, redmineUrl.length-1);
    }
    this.redmineUrl = redmineUrl;
    this.user = config.user;
    this.password = config.password;
  }

  newRequest(requestPath) {
    const redmineUrl = this.redmineUrl;
    const user = this.user;
    const password = this.password;
    const req = {};
    req.url = this.redmineUrl + requestPath;
    if (this.user && this.password) {
      req.auth = {};
      req.auth.user = this.user;
      req.auth.password = this.password;
    }
    return req;
  }

  getProjects(callback) {
    let page = 0;
    let projects = [];
    const redmine = this;
    const next = function(projectList) {
      projectList.forEach(project => projects.push(project));
      if (projectList.length === NB_PROJECTS_PER_PAGE) {
        page++;
        redmine.getProjectListPage(page, next);
      }else{
        callback(projects);
      }
    }
    this.getProjectListPage(page, next);
  }

  getProjectListPage(page, callback) {
    const offset = page * NB_PROJECTS_PER_PAGE;
    console.log("requesting projects list (page="+page+")...");
    request(this.newRequest('/projects.json?offset='+offset), function(error, response, body) {
      if (error) {
        console.log(error);
      }else if(body){
        let projects = JSON.parse(body).projects;
        callback(projects);
      }
    });
  }

  getWikiPages(project, callback) {
    request(this.newRequest('/projects/'+project.identifier+'/wiki/index.json'), function(error, response, body) {
      if (error) {
        console.log(error);
      }else if (body) {
          let pages = []
          try {
            pages = JSON.parse(body).wiki_pages;
          } catch (e) {
            console.log("["+project.identifier+"]Cannot parse JSON string: "+body);
          }
          callback(pages);
      }
    });
  }

  getWikiPage(project, pageName, callback) {
    let path = '/projects/'+project.identifier+'/wiki/'+encodeURIComponent(pageName)+'.json';
    path += '?include=attachments';
    console.log("requesting "+path+"...");
    request(this.newRequest(path), function(error, response, body) {
      if (error) {
        console.log(error);
      }else if (body) {
          let page = null;
          try {
            page = JSON.parse(body).wiki_page;
          } catch (e) {
            console.log("["+project.identifier+"]["+pageName+"] Cannot parse JSON string: "+body);
          }
          callback(page);
      }
    });
  }

  getAttachment(attachment, callback) {
    if (attachment && attachment.id) {
      let req = this.newRequest('/attachments/download/'+attachment.id);
      req.encoding = 'binary';
      request(req, function(error, response, body) {
        if (error) {
          console.log(error);
        }else if (body) {
          callback(body);
        }
      });
    }
  }

}

// Read configuration file
const config = readConfiguration();

// Abort if there is no configuration file
if (!config) {
  console.log('No configuration file found.');
  process.exit(0);
}

// Abort if the redmine url has not been defined
if (!config.redmineUrl) {
  console.log('Cannot found redmine url in '+CONFIG_FILE+'.');
  process.exit(0);
}

const redmine = new Redmine(config);

let outputDir = config.outputDir;
if (outputDir && !outputDir.endsWith('/')) {
  outputDir += '/';
}

// Make sure that the output directory exists
initDirectory(outputDir);

/*
 * Option to run the requests in an insecure mode
 * that does not validate SSL certificates
*/
if (config.insecure == true) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

redmine.getProjects(projects => {
  console.log(projects.length+' projects found.');
  projects.forEach(project => {
    redmine.getWikiPages(project, pages => {
      if (pages.length > 0) {
        console.log(pages.length+" wiki pages found for project "+project.identifier);
        pages.forEach(page => {
          // Retrieve the wiki page's content
          redmine.getWikiPage(project, page.title, (fullPage) => {
            if (fullPage) {
                // Store the wiki page content and its attachments into the output directory
                backupWikiPage(project, fullPage);
            }
          });
        });
      }
    });
  });
});

function readConfiguration() {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
  } catch (e) {
    console.log(e);
  }
  return config;
}

function backupWikiPage(project, page) {
  const projectDir = outputDir+project.identifier
  initDirectory(projectDir);
  fs.writeFileSync(projectDir+'/'+page.title+'.md', page.text);
  if (page.attachments) {
    const attachmentDir = projectDir+'/attachments';
    initDirectory(attachmentDir);
    page.attachments.forEach(attachment => {
      redmine.getAttachment(attachment, (content) => {
        fs.writeFileSync(attachmentDir+'/'+attachment.filename, content, 'binary');
      });
    });
  }
}

function initDirectory(directory) {
  if (directory) {
    try {
      fs.mkdirSync(directory);
    } catch(e) {
      if ( e.code != 'EEXIST' ) throw e;
    }
  }
}

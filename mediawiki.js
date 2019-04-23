/** NODE MODULES **/

// first, let's determine if we can use XMLHttpRequest
const useXMLHttpRequest = typeof XMLHttpRequest !== 'undefined';

let Request = null;
if (!useXMLHttpRequest) {
  // no? ok, assume we're in Node
  Request = require('request');
}


/** GLOBAL VARIABLES **/

// module version number (used in User-Agent)
const version = '0.0.11'; // Todo: Rollup

// module home page (used in User-Agent)
const homepage = 'https://github.com/oliver-moran/mediawiki';

/** PRIVATE UTILITIES **/

// does the work of get and post
/**
 *
 * @param {[type]} args
 * @param {Boolean} isPriority
 * @param {[type]} method
 * @constructor
 * @returns {Promise<>}
 */
function _request(args, isPriority, method) {
  const promise = new Promise();
  _queueRequest.call(this, args, method, isPriority, promise);
  return promise;
}

// queues requests, throttled by settings.rate
/**
 *
 * @param {[type]} args
 * @param {[type]} method
 * @param {Boolean} isPriority
 * @param {[type]} promise
 * @constructor
 * @returns {void}
 */
function _queueRequest(args, method, isPriority, promise){
  if (isPriority === true) {
    this._queue.unshift([args, method, promise])
  } else {
    this._queue.push([args, method, promise])
  }
  _processQueue.call(this);
}

// attempt to process queued requests
/**
 *
 * @returns {void}
 */
function _processQueue() {
  if (this._queue.length == 0) {
    return;
  }
  if (this._inProcess) {
    return;
  }

  this._inProcess = true; // we are go

  const now = (new Date()).getTime()
  let delay = this._future - now;
  if (delay < 0) {
    delay = 0;
  }

  setTimeout(() => {
    _makeRequest.apply(this, this._queue.shift());
  }, delay);
}

// makes a request, regardless of type under Node
/**
 *
 * @param {[type]} args
 * @param {[type]} method
 * @param {[type]} promise
 * @returns {void}
 */
function _makeRequest(args, method, promise) {
  args.format = 'json'; // we will always expect JSON

  if (useXMLHttpRequest) {
    _makeXMLHttpRequestRequest.call(this, args, method, promise);
    return;
  }

  const options = {
    uri: this.settings.endpoint,
    qs: args,
    method,
    form: args,
    jar: true,
    headers: {
      'User-Agent': this.settings.userAgent
    }
  }

  Request.get(options, (error, response, body) => {
    if (!error && response.statusCode == 200) {
      _processResponse.call(this, body, promise);
    } else {
      promise._onError.call(this, new Error(response.statusCode));
    }
  });
}

// makes a request, regardless of type using XMLHttpRequest
/**
 *
 * @param {[type]} args
 * @param {[type]} method
 * @param {[type]} promise
 * @returns {void}
 */
function _makeXMLHttpRequestRequest(args, method, promise) {
  const params = _serialize(args);
  const uri = this.settings.endpoint + '?' + params;

  const request = new XMLHttpRequest();
  request.onreadystatechange = () => {
    if (request.readyState == 4) {
      if (request.status == 200) {
        _processResponse.call(this, request.responseText, promise);
      } else {
        promise._onError.call(this, new Error(request.status));
      }
    }
  };
  request.open(method.toUpperCase(), uri);
  request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
  request.send(params);
}

// make a key-value string from a JavaScript Object
/**
 *
 * @param {[type]} obj
 * @returns {string}
 */
function _serialize(obj) {
  return Object.entries(obj).map(([prop, val]) => {
    return encodeURIComponent(prop) + '=' + encodeURIComponent(val);
  }).join('&');
}

// process an API response
/**
 *
 * @param {string} body
 * @param {[type]} promise
 * @returns {void}
 */
function _processResponse(body, promise) {
  const data = {};
  try {
    data = JSON.parse(body);
  } catch (err) {
    promise._onError.call(this, err);
  }
  promise._onComplete.call(this, data);

  this._future = (new Date()).getTime() + this.settings.rate;
  this._inProcess = false;
  _processQueue.call(this);
}

// does the work of page and revision
// and ensures both functions return the same things
/**
 *
 * @param {[type]} query
 * @param {Boolean} isPriority
 * @constructor
 * @returns {Promise<>}
 */
async function _page (query, isPriority) {
  query.action = 'query';
  query.prop = 'revisions';
  query.rvprop = 'timestamp|content';

  const data = await this.get(query, isPriority);
  Object.values(data.query.pages).forEach(({title, revisions}) => {
    promise._onComplete.call(
      this,
      title,
      revisions[0]['*'],
      new Date(revisions[0].timestamp)
    );
  });
}

// does the work of edit and add
// section should be null to replace the entire page or 'new' to add a new section
function _edit(title, section, text, summary, isPriority) {
  const promise = new Promise();

  this.get({
    action: 'query',
    prop: 'info|revisions',
    intoken: 'edit',
    titles: title
  }, isPriority).complete((data) => {
    //data.tokens.edittoken
    Object.values(data.query.pages).forEach(({
      edittoken: token, starttimestamp, revisions
    }) => {
      const basetimestamp = revisions[0].timestamp;
      const args = {
        action: 'edit', bot: true,
        title, text, summary, token, basetimestamp, starttimestamp
      };
      if (section != null) args.section = section;
      this.post(args, true).complete((data) => {
        if (data.edit.result == 'Success') {
          promise._onComplete.call(this, data.edit.title, data.edit.newrevid,
            new Date(data.edit.newtimestamp));
        } else {
          promise._onError.call(this, new Error(data.edit.result));
        }
      }).error((err) => {
        promise._onError.call(this, err);
      });
    });
  }).error((err) => {
    promise._onError.call(this, err);
  });

  return promise;
}

/** THE BOT CONSTRUCTOR AND SETTINGS **/

class Bot {
  /**
   * The Bot constructor
   * @param {object} config Represents configuration settings
   */
  constructor (config) {
    const settings = {
      endpoint: 'http://en.wikipedia.org:80/w/api.php',
      rate: 60e3 / 10,
      userAgent: (useXMLHttpRequest)
        ? 'MediaWiki/' + version + '; ' + window.navigator.userAgent + '; <' + homepage + '>'
        : 'MediaWiki/' + version + '; Node/' + process.version + '; <' + homepage + '>',
      byeline: '(using the MediaWiki module for Node.js)',
      ...config
    };

    this._future = (new Date()).getTime();
    this._queue = [];
    this._inProcess = false;
  }

  /** GENERIC REQUEST METHODS **/

  /**
   * Makes a GET request
   * @param {object} args the arguments to pass to the WikiMedia API
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   */
  get (args, isPriority) {
    return _request.call(this, args, isPriority, 'GET');
  }

  /**
   * Makes a POST request
   * @param {object} args the arguments to pass to the WikiMedia API
   * @param {boolean} isPriority (optional) should the request be added to the top of the request queue (defualt: false)
   */
  post (args, isPriority) {
    return _request.call(this, args, isPriority, 'POST');
  }

  /** PRE-BAKED FUNCTIONS **/

  /**
   * Log in to the Wiki
   * @param {string} username the user to log in as
   * @param {string} password the password to use
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  async login (username, password, isPriority) {
    const {login: {result, lgusername, token}} = await this.post({
      action: 'login',
      lgname: username,
      lgpassword: password
    }, isPriority);
    switch (result) {
      case 'Success':
        return lgusername;
      case 'NeedToken': {
        const ({login: {result, lgusername}} = await this.post({
          action: 'login',
          lgname: username,
          lgpassword: password,
          lgtoken: token
        }, true);
        if (result === 'Success') {
          return lgusername;
        }
        throw new Error(result);
      } default:
        throw new Error(result);
    }
  }

  /**
   * Logs out of the Wiki
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  logout (isPriority) {
    // post to MAKE SURE it always happens
    return this.post({action: 'logout'}, isPriority);
  }

  /**
   * Requests the current user name
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<string>}
   */
  async name (isPriority) {
    const {name} = await this.userinfo(isPriority);
    return name;
  }

  /**
   * Requests the current userinfo
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  async userinfo (isPriority) {
    return this.get({ action: 'query', meta: 'userinfo' }, isPriority).complete((data) => {
      promise._onComplete.call(this, data.query.userinfo);
    });
  }

  /**
   * Request the content of page by title
   * @param {string} title the title of the page
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  page (title, isPriority) {
    return _page.call(this, { titles: title }, isPriority);
  }

  /**
   * Request the content of page by revision ID
   * @param {string} id the revision ID of the page
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  revision (id, isPriority) {
    return _page.call(this, { revids: id }, isPriority);
  }

  /**
   * Request the history of page by title
   * @param {string} title the title of the page
   * @param {integer|string} count how many revisions back to return
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  history (title, count, isPriority) {
    const promise = new Promise();

    let c = '';
    let rvc = '';
    const history = [];
    (function next(isPriority){
      const args = {
        action: 'query',
        prop: 'revisions',
        titles: title,
        rvprop: 'timestamp|user|ids|comment|size|tags',
        rvlimit: count,
        continue: c
      };
      if (c != '') {
        args.rvcontinue = rvc;
      }
      this.get(args, isPriority).complete(({
        query: {pages}, continue: cont
      }) => {
        const page = Object.values(pages)[0];
        page.revisions.forEach((revision) => {
          revision.timestamp = new Date(revision.timestamp);
          if (history.length < count) {
            history.push(revision);
          }
        });
        if (cont && history.length < count) {
          c = cont.continue;
          rvc = cont.rvcontinue;
          next.call(this, true);
        } else {
          promise._onComplete.call(this, page.title, history);
        }
      }).error((err) => {
        promise._onError.call(this, err);
      });
    }).call(this, isPriority);

    return promise;
  }

  /**
   * Request the members of a category by category title
   * @param {string} category the title of the category
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  category (category, isPriority) {
    const promise = new Promise();

    let c = '';
    let cmc = '';
    const pages = [];
    const subcategories = [];
    (function next (isPriority) {
      const args = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit:'max',
        cmsort: 'sortkey',
        cmdir: 'desc',
        continue: c
      };
      if (c != '') {
        args.cmcontinue = cmc;
      }
      this.get(args, isPriority).complete((data) => {
        const members = data.query.categorymembers;
        members.forEach((member) => {
          if (member.ns === 14) {
            subcategories.push(member.title);
           } else {
            pages.push(member.title);
          }
        });
        if (data.continue) {
          c = data.continue.continue;
          cmc = data.continue.cmcontinue;
          next.call(this, true);
        } else {
          promise._onComplete.call(this, category, pages, subcategories);
        }
      }).error( (err) {
        promise._onError.call(this, err);
      });
    }).call(this, isPriority);

    return promise;
  }


  /**
   * Edits a page on the wiki
   * @param {string} title the title of the page to edit
   * @param {string} text the text to replace the current content with
   * @param {string} summary an edit summary to leave (the bot's byeline will be appended after a space)
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  edit (title, text, summary, isPriority) {
    summary += ' ' + this.settings.byeline;
    return _edit.call(this, title, null, text, summary, isPriority);
  }

  /**
   * Adds a section to a page on the wiki
   * @param {string} title the title of the page to edit
   * @param {string} heading the heading text for the new section
   * @param {string} body the body text of the new section
   * @param {boolean} [isPriority] should the request be added to the top of the request queue (defualt: false)
   * @returns {Promise<>}
   */
  add (title, heading, body, isPriority) {
    return _edit.call(this, title, 'new', body, heading, isPriority);
  }
}

// TODO: get these pages and categories in a category

/** MODULE EXPORTS **/

export {version, Bot};

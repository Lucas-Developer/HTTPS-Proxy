/**
 * A simple HTTP server that will forward incoming requests for sites
 * using the HTTP protocol to an HTTPS version if there is such a known
 * version in the HTTPS Everywhere ruleset library.
 * Information that gets passed on includes:
 * 1. Headers
 * 2. Request method
 * 3. Request body
 */

var http = require('http');
var request = require('request');
var config = require('./config');
var HttpsRewriter = require('./rewriter').HttpsRewriter;

// It takes a little time to load up the rulesets, so it's best
// to do it once at startup.
console.log('Loading rulesets');
var rewriter = new HttpsRewriter();

// A list of the types of requests (by method) that can have bodies we want to forward.
// See wikipedia for a list of all the existing HTTP request methods
// https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol#Request_methods
const CAN_HAVE_BODY = [
  'POST',
  'PUT',
  'PATCH'
];

/**
 * Help handle a POST request or other with a request body
 * by accumulating the body contents as they are received.
 * @param {http.IncomingMessage} req - The incoming request object
 * @param {function} callback - A callback invoked with any error and the body
 */
function handleBody(req, callback) {
  var postedData = '';
  // Read for post data
  req.on('data', function (data) {
    postedData += data;
    // Flood attack!
    if (postedData.length > 1e6) {
      request.connection.destroy();
      callback(new error('Request too large'), null);
    }
  });
  // Invoke the callback when we have all the data
  req.on('end', function () {
    callback(null, postedData);
  });
}

/**
 * Produce an `options` object for the outgoing request based on
 * data received by our own HTTP server and the provided config.
 * @param {string} url - The URL to request
 * @param {object} headers - An object containing key-value headers
 * @param {string} method - The HTTP method to use, e.g. get, post, ...
 */
function requestOptions(url, headers, method) {
  var options = {
    url: url,
    headers: headers,
    method: method.toUpperCase(),
    followRedirect: config.followRedirect,
    followAllRedirects: config.followAllRedirects,
    maxRedirects: config.maxRedirects,
    strictSSL: config.strictSSL,
  };
  if (config.useTunnel) {
    options.tunnel = config.tunnel;
  }
  if (config.useProxy) {
    options.proxy = config.proxy;
  }
  return options;
}

/**
 * Report that an error occurred.
 * Sets the status code to 500 and writes the error message as the body.
 * @param {http.ServerResponse} res - The outgoing response object
 * @param {error} error - The error object received
 */
function reportError(res, error) {
  res.statusCode = 500;
  res.write(err.message);
  res.end();
}

/**
 * Make a request out of the proxy server with the provided options and
 * write back either any error that occurs in making the request or
 * else the response from the web server.
 * @param {http.ServerResponse} res - The outgoing response object
 * @param {object} options - The options object to dictate what the request does
 */
function forwardRequest(res, options) {
  request(options, function (err, response, body) {
    body = body.toString();
    if (err) {
      reportError(res, err);
    } else {
      var headers = Object.keys(response.headers());
      for (var i = 0, len = headers.length(); i < len; i++) {
        res.setHeader(headers[i], response.headers[headers[i]]);
      }
      res.statusCode = response.statusCode;
      if (config.rewritePages) {
        body = rewriter.process(body);
      }
      res.write(body);
      res.end();
    }
  });
}

/**
 * Read in information from the incoming request to pass on in the outgoing
 * request and write back either any error in reading the request body
 * or else the response.
 * @param {http.IncomingMessage} req - The incoming request object
 * @param {http.ServerResponse} res - The outgoing response object
 */
function proxy(req, res) {
  var newUrl = rewriter.process(req.url);
  var options = requestOptions(newUrl, req.rawHeaders, req.method);
  if (CAN_HAVE_BODY.indexOf(method) >= 0) {
    handleBody(req, function (err, body) {
      if (err) {
        reportError(res, err);
      } else {
        options.body = body;
        forwardRequest(res, options);
      }
    });
  } else {
    forwardRequest(res, options);
  }
}

console.log('Starting HTTP server');
var server = http.createServer(proxy);
server.listen(config.port, config.address));
console.log('Server running on ' + config.address + ':' + config.port);
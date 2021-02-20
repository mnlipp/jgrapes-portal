/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2016, 2019  Michael N. Lipp
 *
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Affero General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License 
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

/**
 * JGConsole establishes a namespace for the JavaScript functions
 * that are provided by the console.
 * 
 * @module console-base-resource/jgconsole
 */
 
/** The exported class used to access everything. */
export class JGConsole {};
export default JGConsole;

// For global access
window.JGConsole = JGConsole;

/**
 * String constants for render modes.
 * 
 * @memberof JGConsole
 */
const RenderMode = Object.freeze({
    Preview: "Preview",
    View: "View",
    Edit: "Edit",
    Help: "Help",
    StickyPreview: "StickyPreview",
    Foreground: "Foreground",
});

export { RenderMode };

/**
 * Make RenderMode available as property of JGConsole.
 */
JGConsole.RenderMode = RenderMode;


/**
 * Easy access to logging.
 */
export class Log {

    /**
     * Output a debug message.
     * @param {string} message the message to print
     */
    static debug (message) {
        if (console && console.debug) {
            console.debug(JGConsole.Log.format(new Date()) + ": " + message);
        }
    }
    
    /**
     * Output an info message.
     * @param {string} message the message to print
     */
    static info(message) {
        if (console && console.info) {
            console.info(JGConsole.Log.format(new Date()) + ": " + message)
        }
    }
    
    /**
     * Output a warn message.
     * @param {string} message the message to print
     */
    static warn(message) {
        if (console && console.warn) {
            console.warn(JGConsole.Log.format(new Date()) + ": " + message);
        }
    }
    
    /**
     * Output an error message.
     * @param {string} message the message to print
     */
    static error(message) {
        if (console && console.error) {
            console.error(JGConsole.Log.format(new Date()) + ": " + message);
        }
    }
};

/**
 * Make class Log available as property of JGConsole.
 */
JGConsole.Log = Log;

var logDateTimeFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
});

var logDateTimeMillis = new Intl.NumberFormat(undefined, {
    minimumIntegerDigits: 1,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
});

/**
 * Format the given date as appropriate for a log time stamp.
 *
 * @param {Date} date the date to format
 */
Log.format = function(date) {
    return logDateTimeFormat.format(date) 
        + logDateTimeMillis.format(date.getMilliseconds()/1000).substring(1);
}

// ///////////////////
// WebSocket "wrapper"
// ///////////////////

/**
 * Defines a wrapper class for a web socket. An instance 
 * creates and maintains a connection to a session on the
 * server, i.e. it reconnects automatically to the session
 * when the connection is lost. The connection is used to
 * exchange JSON RPC notifications.
 */
class ConsoleWebSocket {

    constructor(console) {
        // "Privacy by convention" is sufficient for this.
        this._debugHandler = false;
        this._console = console;
        this._ws = null;
        this._sendQueue = [];
        this._recvQueue = [];
        this._recvQueueLocks = 0;
        this._messageHandlers = {};
        this._isHandling = false;
        this._refreshTimer = null;
        this._inactivity = 0;
        this._reconnectTimer = null;
        this._connectRequested = false;
        this._initialConnect = true;
        this._consoleSessionId = null;
        this._connectionLost = false;
        this._oldConsoleSessionId = sessionStorage.getItem("org.jgrapes.webconsole.base.sessionId");
    };

    /**
     * Returns the unique session id used to identify the connection.
     * 
     * @return {string} the id
     */
    consoleSessionId() {
        return this._consoleSessionId;
    }

    _connect() {
        let location = (window.location.protocol === "https:" ? "wss" : "ws") +
            "://" + window.location.host + window.location.pathname;
        if (!location.endsWith("/")) {
            location += "/";
        }
        this._consoleSessionId = sessionStorage.getItem("org.jgrapes.webconsole.base.sessionId");
        location += "console-session/" + this._consoleSessionId;
        if (this._oldConsoleSessionId) {
            location += "?was=" + this._oldConsoleSessionId;
            this._oldConsoleSessionId = null;
        }
        Log.debug("Creating WebSocket for " + location);
        this._ws = new WebSocket(location);
        Log.debug("Created WebSocket with readyState " + this._ws.readyState);
        let _this = this;
        this._ws.onopen = function() {
            Log.debug("OnOpen called for WebSocket.");
            if (_this._connectionLost) {
                _this._connectionLost = false;
                _this._console.connectionRestored();
            }
            _this._drainSendQueue();
            if (_this._initialConnect) {
                _this._initialConnect = false;
            } else {
                // Make sure to get any lost updates
                let renderer = _this._console._renderer;
                renderer.findPreviewIds().forEach(function(id) {
                    renderer.sendRenderConlet(id, [RenderMode.Preview]);
                });
                renderer.findViewIds().forEach(function(id) {
                    renderer.sendRenderConlet(id, [RenderMode.View]);
                });
            }
            _this._refreshTimer = setInterval(function() {
                if (_this._sendQueue.length == 0) {
                    _this._inactivity += _this._console.sessionRefreshInterval;
                    if (_this._console.sessionInactivityTimeout > 0 &&
                        _this._inactivity >= _this._console.sessionInactivityTimeout) {
                        _this.close();
                        _this._console.connectionSuspended(function() {
                            _this.connect();
                        });
                        return;
                    }
                    _this._send({
                        "jsonrpc": "2.0", "method": "keepAlive",
                        "params": []
                    });
                }
            }, _this._console.sessionRefreshInterval);
        }
        this._ws.onclose = function(event) {
            Log.debug("OnClose called for WebSocket (reconnect: " +
                _this._connectRequested + ").");
            if (_this._refreshTimer !== null) {
                clearInterval(_this._refreshTimer);
                _this._refreshTimer = null;
            }
            if (_this._connectRequested) {
                // Not an intended disconnect
                if (!_this._connectionLost) {
                    _this._console.connectionLost();
                    _this._connectionLost = true;
                }
                _this._initiateReconnect();
            }
        }
        // "onClose" is called even if the initial connection fails,
        // so we don't need "onError".
        // this._ws.onerror = function(event) {
        // }
        this._ws.onmessage = function(event) {
            var msg;
            try {
                msg = JSON.parse(event.data);
            } catch (e) {
                Log.error(e.name + ":" + e.lineNumber + ":" + e.columnNumber
                    + ": " + e.message + ". Data: ");
                Log.error(event.data);
                return;
            }
            _this._recvQueue.push(msg);
            if (_this._recvQueue.length === 1) {
                _this._handleMessages();
            }
        }
    }

    /**
     * Establishes the connection.
     */
    connect() {
        this._connectRequested = true;
        let _this = this;
        $(window).on('beforeunload', function() {
            Log.debug("Closing WebSocket due to page unload");
            // Internal connect, don't send disconnect
            _this._connectRequested = false;
            _this._ws.close();
        });
        this._connect();
    }

    /**
     * Closes the connection.
     */
    close() {
        if (this._consoleSessionId) {
            this._send({
                "jsonrpc": "2.0", "method": "disconnect",
                "params": [this._consoleSessionId]
            });
        }
        this._connectRequested = false;
        this._ws.close();
    }

    _initiateReconnect() {
        if (!this._reconnectTimer) {
            let _this = this;
            this._reconnectTimer = setTimeout(function() {
                _this._reconnectTimer = null;
                _this._connect();
            }, 1000);
        }
    }

    _drainSendQueue() {
        while (this._ws.readyState == this._ws.OPEN && this._sendQueue.length > 0) {
            let msg = this._sendQueue[0];
            try {
                this._ws.send(msg);
                this._sendQueue.shift();
            } catch (e) {
                Log.warn(e);
            }
        }
    }

    _send(data) {
        this._sendQueue.push(JSON.stringify(data));
        this._drainSendQueue();
    }

    /**
     * Convert the passed object to its JSON representation
     * and sends it to the server. The object should represent
     * a JSON RPC notification.
     * 
     * @param  {Object} data the data
     */
    send(data) {
        this._inactivity = 0;
        this._send(data);
    }

    /**
     * When a JSON RPC notification is received, its method property
     * is matched against all added handlers. If a match is found,
     * the associated handler function is invoked with the
     * params values from the notification as parameters.
     * 
     * @param {string} method the method property to match
     * @param {function} handler the handler function
     */
    addMessageHandler(method, handler) {
        this._messageHandlers[method] = handler;
    }

    _handlerLog(msgSup) {
        if (this._debugHandler) {
            Log.debug(msgSup());
        }
    }

    _handleMessages() {
        if (this._isHandling) {
            return;
        }
        this._isHandling = true;
        while (true) {
            if (this._recvQueueLocks > 0) {
                this._handlerLog(() => "Handler receive queue locked.");
                break;
            }
            if (this._recvQueue.length === 0) {
                this._handlerLog(() => "Handler receive queue empty.");
                break;
            }
            var message = this._recvQueue.shift();
            var handler = this._messageHandlers[message.method];
            if (!handler) {
                Log.error("No handler for invoked method " + message.method);
                continue;
            }
            if (message.hasOwnProperty("params")) {
                this._handlerLog(() => "Handling: " + message.method
                    + "[" + message.params + "]");
                handler(...message.params);
            } else {
                this._handlerLog(() => "Handling: " + message.method);
                handler();
            }
        }
        this._isHandling = false;
    }

    lockMessageReceiver() {
        this._recvQueueLocks += 1;
        if (this._debugHandler) {
            try {
                throw new Error("Lock");
            } catch (exc) {
                Log.debug("Locking receiver:\n" + exc.stack);
            }
        }
    }

    unlockMessageReceiver() {
        this._recvQueueLocks -= 1;
        if (this._debugHandler) {
            try {
                throw new Error("Unlock");
            } catch (exc) {
                Log.debug("Unlocking receiver:\n" + exc.stack);
            }
        }
        if (this._recvQueueLocks == 0) {
            this._handleMessages();
        }
    }
}

class ResourceManager {

    constructor(console) {
        this._console = console;
        this._debugLoading = false;
        this._providedScriptResources = new Set(); // Names, i.e. strings
        document.querySelectorAll("script[data-jgwc-provides]").forEach(s => {
            s.getAttribute("data-jgwc-provides").split(",").forEach(
                n => this._providedScriptResources.add(n.trim()));
        });
        if (this._debugLoading) {
            Log.debug("Initially provided: "
             + [...this._providedScriptResources].join(", "));
        }
        this._unresolvedScriptRequests = []; // ScriptResource objects
        this._loadingScripts = new Set(); // uris (src attribute)
        this._unlockMessageQueueAfterLoad = false;
        this._loadingTimeoutHandler = null;
        this._scriptResourceSnippet = 0;
    }

    _loadingMsg(msg) {
        if (this._debugLoading) {
            Log.debug(msg());
        }
    }

    _mayBeStartScriptLoad(scriptResource) {
        let _this = this;
        if (_this._debugLoading) {
            if (scriptResource.provides.length > 0) {
                scriptResource.id = scriptResource.provides.join("/");
            } else if (scriptResource.uri) {
                scriptResource.id = scriptResource.uri;
            } else {
                scriptResource.id = "Snippet_" + ++this._scriptResourceSnippet;
            }
        }
        let stillRequired = scriptResource.requires;
        scriptResource.requires = [];
        stillRequired.forEach(function(required) {
            if (!_this._providedScriptResources.has(required)) {
                scriptResource.requires.push(required);
            }
        });
        if (scriptResource.requires.length > 0) {
            _this._loadingMsg(function() {
                return "Not (yet) loading: " + scriptResource.id
                    + ", missing: " + scriptResource.requires.join(", ")
            });
            _this._unresolvedScriptRequests.push(scriptResource);
            return;
        }
        this._startScriptLoad(scriptResource);
    }

    _startScriptLoad(scriptResource) {
        let _this = this;
        let head = $("head").get()[0];
        let script = document.createElement("script");
        if (scriptResource.id) {
            script.setAttribute("id", scriptResource.id);
        }
        if (scriptResource.type) {
            script.setAttribute("type", scriptResource.type);
        }
        if (scriptResource.source) {
            // Script source is part of request, add and proceed as if loaded.
            script.text = scriptResource.source;
            head.appendChild(script);
            _this._scriptResourceLoaded(scriptResource);
            return;
        }
        if (!scriptResource.uri) {
            return;
        }
        // Asynchronous loading.
        script.src = scriptResource.uri;
        script.async = true;
        script.addEventListener('load', function(event) {
            // Remove this from loading
            _this._loadingScripts.delete(script.src);
            _this._scriptResourceLoaded(scriptResource);
        });
        // Put on script load queue to indicate load in progress
        _this._loadingMsg(function() { return "Loading: " + scriptResource.id });
        _this._loadingScripts.add(script.src);
        if (this._loadingTimeoutHandler === null) {
            this._loadingTimeoutHandler = setInterval(
                function() {
                    Log.warn("Still waiting for: "
                        + Array.from(_this._loadingScripts).join(", "));
                }, 5000)
        }
        head.appendChild(script);
    }

    _scriptResourceLoaded(scriptResource) {
        let _this = this;
        // Whatever it provides is now provided
        this._loadingMsg(function() { return "Loaded: " + scriptResource.id });
        scriptResource.provides.forEach(function(res) {
            _this._providedScriptResources.add(res);
        });
        // Re-evaluate
        let nowProvided = new Set(scriptResource.provides);
        let stillUnresolved = _this._unresolvedScriptRequests;
        _this._unresolvedScriptRequests = [];
        stillUnresolved.forEach(function(reqRes) {
            // Still required by this unresolved resource
            let stillRequired = reqRes.requires;
            reqRes.requires = []; // Accumulates new value
            stillRequired.forEach(function(required) {
                if (!nowProvided.has(required)) {
                    // Not in newly provided, still required
                    reqRes.requires.push(required);
                }
            });
            if (reqRes.requires.length == 0) {
                _this._startScriptLoad(reqRes);
            } else {
                // Back to still unresolved
                _this._unresolvedScriptRequests.push(reqRes);
            }
        });
        // All done?
        if (_this._loadingScripts.size == 0) {
            if (this._loadingTimeoutHandler !== null) {
                clearInterval(this._loadingTimeoutHandler);
                this._loadingTimeoutHandler = null;
            }
            if (_this._unlockMessageQueueAfterLoad) {
                _this._loadingMsg(function() { return "All loaded, unlocking message queue." });
                _this._console.unlockMessageQueue();
            }
        }
    }

    addPageResources(cssUris, cssSource, scriptResources) {
        for (let index in cssUris) {
            let uri = cssUris[index];
            if ($("head > link[href='" + uri + "']").length === 0) {
                $("head link[rel='stylesheet']:last").after("<link rel='stylesheet' href='" + uri + "'>");
            }
        }
        if (cssSource) {
            let style = $("style");
            style.text(cssSource);
            $("head link[rel='stylesheet']:last").after(style);
        }
        // Don't use jquery, https://stackoverflow.com/questions/610995/cant-append-script-element
        for (let index in scriptResources) {
            let scriptResource = scriptResources[index];
            if (scriptResource.uri) {
                if ($("head > script[src='" + scriptResource.uri + "']").length > 0) {
                    continue;
                }
            }
            this._mayBeStartScriptLoad(scriptResource);
        }
    }

    lockWhileLoading() {
        if (this._loadingScripts.size > 0 && !this._unlockMessageQueueAfterLoad) {
            this._console.lockMessageQueue();
            this._loadingMsg(function() { return "Locking message queue until all loaded." });
            this._unlockMessageQueueAfterLoad = true;
        }
    }
}

/**
 * A base class for implementing a portral renderer. The renderer
 * provides the DOM, based on the initial DOM from the console page.
 */
class Renderer {

    init() {
    }

    /**
     * Provides access to the console instance.
     *
     * @return {Console} the console
     */
    console() {
        return theConsole;
    }

    /**
     * Called from the console when the connection to the server is lost.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a notification.
     */
    connectionLost() {
        Log.warn("Connection lost notification not implemented!");
    }

    /**
     * Called from the console when the connection to the server is restored.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a notification.
     */
    connectionRestored() {
        Log.warn("Connection restored notification not implemented!");
    }

    /**
     * Called from the console when the connection to the server is syspended.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a modal dialog.
     */
    connectionSuspended(resume) {
        Log.warn("Connection suspended dialog not implemented!");
    }

    /**
     * Called from the console when the console is configured.
     * The default implementation prints a warning message to the console.
     * Should be overridden by a funtion that displays a modal dialog.
     */
    consoleConfigured() {
        Log.warn("Console configured handling not implemented!");
    }

    /**
     * Called from the console when a new conlet type is been added.
     * @param {string} conletType the conlet type
     * @param {Object} displayNames the display names by lang
     * @param {Array.string} renderModes the render modes
     */
    addConletType(conletType, displayNames, renderModes) {
        Log.warn("Not implemented!");
    }

    /**
     * Called from the console when the console layout is received.
     *
     * @param {string[]} previewLayout the conlet ids from top left
     * to bottom right
     * @param {string[]} tabsLayout the ids of the conlets viewable in tabs
     * @param {Object} xtraInfo extra information spcific to the 
     * console implementation
     */
    lastConsoleLayout(previewLayout, tabsLayout, xtraInfo) {
        Log.warn("Not implemented!");
    }

    /**
     * Update the preview of the given conlet.
     *
     * @param {boolean} isNew `true` if it is a new conlet preview
     * @param {HTMLElement} container the container for the preview,
     * provided as:
     * ```
     * <section class='conlet conlet-preview' 
     *      data-conlet-type='...' data-conlet-id='...' 
     *      data-conlet-grid-columns='...' data-conlet-grid-rows='   '></section>
     * ```
     * @param {string[]} modes the supported conlet modes
     * @param {string} content the preview content
     * @param {boolean} foreground `true` if the preview (i.e. the overview
     * plane) is to be made the active tab
     */
    updateConletPreview(isNew, container, modes, content, foreground) {
        Log.warn("Not implemented!");
    }

    /**
     * Update the view of the given conlet.
     *
     * @param {boolean} isNew `true` if it is a new conlet view
     * @param {HTMLElement} container the container for the view,
     * provided as:
     * ```
     * <article class="conlet conlet-view conlet-content 
     *      data-conlet-type='...' data-conlet-id='...'"></article>"
     * ```
     * @param {string[]} modes the supported conlet modes
     * @param {string} content the view content
     * @param {boolean} foreground `true` if the view 
     * is to be made the active tab
     */
    updateConletView(isNew, container, modes, content, foreground) {
        Log.warn("Not implemented!");
    }

    /**
     * Remove the given conlet representations, which may be 
     * preview or view containers, from the DOM.
     *
     * @param {NodeList} containers the existing containers for
     * the preview or views 
     */
    removeConletDisplays(containers) {
        Log.warn("Not implemented!");
    }

    /**
     * Update the title of the conlet with the given id.
     *
     * @param {string} conletId the conlet id
     * @param {string} title the new title
     */
    updateConletTitle(conletId, title) {
        Log.warn("Not implemented!");
    }

    /**
     * Update the modes of the conlet with the given id.
     * 
     * @param {string} conletId the conlet id
     * @param {string[]} modes the modes
     */
    updateConletModes(conletId, modes) {
        Log.warn("Not implemented!");
    }

    /**
     * Opens an edit dialog.
     * 
     * @param {HTMLElement} container the container for the dialog
     * @param {Array.string} modes the modes
     * @param {string} content the content as HTML
     */
    showEditDialog(container, modes, content) {
        Log.warn("Not implemented!");
    }

    /**
     * Displays a notification.
     *
     * @param {string} content the content to display
     * @param {object} options the options
     * @param {boolean} options.error if this is an error notification (deprecated)
     * @param {string} options.type one of "error", "success", "warning",
     *                          "danger", "info" (default)
     * @param {boolean} options.closeable if the notification may be closed by 
     *                          the user
     * @param {number} options.autoClose close the notification automatically 
     *                          after the given number of milliseconds
     */
    notification(content, options) {
        Log.warn("Not implemented!");
    }

    // Send methods

    /**
     * @deprecated Use console().setLocale() instead.
     */
    sendSetLocale(locale, reload) {
        this.console().setLocale(locale, reload);
    };

    /**
     * @deprecated Use console().renderConlet() instead.
     */
    sendRenderConlet(conletId, modes) {
        this.console().renderConlet(conletId, modes);
    };

    /**
     * @deprecated Use console().addConlet() instead.
     */
    sendAddConlet(conletType, renderModes) {
        this.console().addConlet(conletType, renderModes);
    };

    /**
     * @deprecated Use console().removePreview() and console().removeView() instead.
     */
    sendDeleteConlet(conletId) {
        this.console().removePreview(conletId);
    };

    /**
     * @deprecated Use console().updateLayout() instead.
     */
    sendLayout(previewLayout, tabLayout, xtraInfo) {
        this.console().updateLayout(previewLayout, tabLayout, xtraInfo);
    };

    /**
     * @deprecated Use console().send() instead.
     */
    send(method, ...params) {
        this.console().send(method, ...params);
    };

    // Utility methods.

    /**
     * Find the HTML elements that display the preview or view of the
     * conlet with the given id.
     * 
     * @param {string} conletId the conlet id
     * @return {NodeList} the elements found
     */
    findConletContainers(conletId) {
        return $(".conlet[data-conlet-id='" + conletId + "']").get();
    };

    /**
     * Find the HTML element that displays the preview of the
     * conlet with the given id.
     * 
     * @param {string} conletId the conlet id
     * @return {HTMLElement} the HTML element or null
     */
    findConletPreview(conletId) {
        return document.querySelector(
            ".conlet-preview[data-conlet-id='" + conletId + "']");
    };

    /**
     * Return the ids of all conlets displayed as preview.
     *
     * @return {string[]}
     */
    findPreviewIds() {
        return Array.from(
            document.querySelectorAll(".conlet-preview[data-conlet-id]"),
            node => node.getAttribute("data-conlet-id"));
    }

    /**
     * Find the HTML element that displays the view of the
     * conlet with the given id.
     * 
     * @param {string} conletId the conlet id
     * @return {HTMLElement} the HTML element
     */
    findConletView(conletId) {
        return document.querySelector(
            ".conlet-view[data-conlet-id='" + conletId + "']");
    };

    /**
     * Return the ids of all conlets displayed as view.
     *
     * @return {string[]}
     */
    findViewIds() {
        return Array.from(
            document.querySelectorAll(".conlet-view[data-conlet-id]"),
            node => node.getAttribute("data-conlet-id"));
    }

    /**
     * Utility method to format a memory size to a maximum
     * of 4 digits for the integer part by appending the
     * appropriate unit.
     * 
     * @param {integer} size the size value to format
     * @param {integer} digits the number of digits of the factional part
     * @param {string} lang the language (BCP 47 code, 
     * used to determine the delimiter)
     */
    formatMemorySize(size, digits, lang) {
        if (lang === undefined) {
            lang = digits;
            digits = -1;
        }
        let scale = 0;
        while (size > 10000 && scale < 5) {
            size = size / 1024;
            scale += 1;
        }
        let unit = "PiB";
        switch (scale) {
            case 0:
                unit = "B";
                break;
            case 1:
                unit = "kiB";
                break;
            case 2:
                unit = "MiB";
                break;
            case 3:
                unit = "GiB";
                break;
            case 4:
                unit = "TiB";
                break;
            default:
                break;
        }
        if (digits >= 0) {
            return new Intl.NumberFormat(lang, {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            }).format(size) + " " + unit;
        }
        return new Intl.NumberFormat(lang).format(size) + " " + unit;
    }

}

/**
 * Make class Renderer available as property of JGConsole.
 */
JGConsole.Renderer = Renderer;

/**
 * Provides console related methods. A singleton is automatically
 * created. Selected methods are made available in the JGConsole
 * namespace.
 */
class Console {

    constructor() {
        let _this = this;
        this._isConfigured = false;
        this._sessionRefreshInterval = 0;
        this._sessionInactivityTimeout = 0;
        this._renderer = null;
        this._webSocket = new ConsoleWebSocket(this);
        this._conletFunctionRegistry = {};
        this._previewTemplate = $('<section class="conlet conlet-preview"></section>');
        this._viewTemplate = $('<article class="conlet conlet-view conlet-content"></article>');
        this._editTemplate = $('<div class="conlet conlet-edit"></div>');
        this._webSocket.addMessageHandler('addPageResources',
            function(cssUris, cssSource, scriptResources) {
                _this._resourceManager.addPageResources(cssUris, cssSource, scriptResources);
            });
        this._webSocket.addMessageHandler('addConletType',
            function(conletType, displayNames, cssUris, scriptResources,
                renderModes) {
                _this._resourceManager.addPageResources(cssUris, null, scriptResources);
                _this._renderer.addConletType(conletType, displayNames, renderModes);
            });
        this._webSocket.addMessageHandler('lastConsoleLayout',
            function(previewLayout, tabsLayout, xtraInfo) {
                // Should we wait with further actions?
                _this._resourceManager.lockWhileLoading();
                _this._renderer.lastConsoleLayout(previewLayout, tabsLayout, xtraInfo);
            });
        this._webSocket.addMessageHandler('notifyConletView',
            function notifyConletView(conletClass, conletId, method, params) {
                let classRegistry = _this._conletFunctionRegistry[conletClass];
                if (classRegistry) {
                    let f = classRegistry[method];
                    if (f) {
                        f(conletId, params);
                    }
                }
            });
        this._webSocket.addMessageHandler('consoleConfigured',
            function consoleConfigured() {
                _this._isConfigured = true;
                _this._renderer.consoleConfigured();
            });
        this._webSocket.addMessageHandler('updateConlet',
            function(conletType, conletId, renderAs, supported, content) {
                if (renderAs.includes(RenderMode.Preview)) {
                    _this._updatePreview(conletType, conletId, supported, content, 
                    renderAs.includes(RenderMode.StickyPreview),
                    renderAs.includes(RenderMode.Foreground));
                } else if (renderAs.includes(RenderMode.View)) {
                    _this._updateView(conletType, conletId, supported, content,
                    renderAs.includes(RenderMode.Foreground));
                } else if (renderAs.includes(RenderMode.Edit)) {
                    let container = _this._editTemplate.clone();
                    container.attr("data-conlet-type", conletType);
                    container.attr("data-conlet-id", conletId);
                    _this._renderer.showEditDialog(container[0], supported, content);
                    if (!container[0].parentNode) {
                        $("body").append(container);
                    }
                    _this._execOnLoad(container, false);
                }
            });
        this._webSocket.addMessageHandler('deleteConlet',
            function deleteConlet(conletId, renderModes) {
                if (renderModes.length === 0 
                    || renderModes.includes(RenderMode.Preview)) {
                    _this.removePreview(conletId);
                }
                if (renderModes.includes(RenderMode.View)) {
                    _this.removeView(conletId);
                }
            });
        this._webSocket.addMessageHandler('displayNotification',
            function(content, options) {
                _this._renderer.notification(content, options);
            });
        this._webSocket.addMessageHandler('retrieveLocalData',
            function retrieveLocalData(path) {
                let result = [];
                try {
                    for (let i = 0; i < localStorage.length; i++) {
                        let key = localStorage.key(i);
                        if (!path.endsWith("/")) {
                            if (key !== path) {
                                continue;
                            }
                        } else {
                            if (!key.startsWith(path)) {
                                continue;
                            }
                        }
                        let value = localStorage.getItem(key);
                        result.push([key, value])
                    }
                } catch (e) {
                    Log.error(e);
                }
                _this._webSocket.send({
                    "jsonrpc": "2.0", "method": "retrievedLocalData",
                    "params": [result]
                });
            });
        this._webSocket.addMessageHandler('storeLocalData',
            function storeLocalData(actions) {
                try {
                    for (let i in actions) {
                        let action = actions[i];
                        if (action[0] === "u") {
                            localStorage.setItem(action[1], action[2]);
                        } else if (action[0] === "d") {
                            localStorage.removeItem(action[1]);
                        }
                    }
                } catch (e) {
                    Log.error(e);
                }
            });
        this._webSocket.addMessageHandler('reload',
            function() {
                window.location.reload(true);
            });
    }

    init(consoleSessionId, refreshInterval, inactivityTimeout, renderer) {
        Log.debug("JGConsole: Initializing console...");
        sessionStorage.setItem("org.jgrapes.webconsole.base.sessionId", consoleSessionId);
        this._resourceManager = new ResourceManager(this);
        this._sessionRefreshInterval = refreshInterval;
        this._sessionInactivityTimeout = inactivityTimeout;
        this._renderer = renderer;
        JGConsole.renderer = renderer;

        // Everything set up, can connect web socket now.
        this._webSocket.connect();

        // More initialization.
        Log.debug("JGConsole: Initializing renderer...");
        this._renderer.init();

        // With everything prepared, send console ready
        this.send("consoleReady");
        Log.debug("JGConsole: ConsoleReady sent.");
    }

    get isConfigured() {
        return this._isConfigured;
    }

    get sessionRefreshInterval() {
        return this._sessionRefreshInterval;
    }

    get sessionInactivityTimeout() {
        return this._sessionInactivityTimeout;
    }

    get renderer() {
        return this._renderer;
    }

    connectionLost() {
        this._renderer.connectionLost();
    }

    connectionRestored() {
        this._renderer.connectionRestored();
    }

    connectionSuspended(resume) {
        this._renderer.connectionSuspended(resume);
    }

    /**
     * Increases the lock count on the receiver. As long as
     * the lock count is greater than 0, the invocation of
     * handlers is suspended.
     */
    lockMessageQueue() {
        this._webSocket.lockMessageReceiver();
    }

    /**
     * Decreases the lock count on the receiver. When the
     * count reaches 0, the invocation of handlers is resumed.
     */
    unlockMessageQueue() {
        this._webSocket.unlockMessageReceiver();
    }

    // Conlet management

    _updatePreview(conletType, conletId, modes, content, sticky, foreground) {
        let container = this._renderer.findConletPreview(conletId);
        let isNew = !container;
        if (isNew) {
            container = this._previewTemplate.clone();
            container.attr("data-conlet-type", conletType);
            container.attr("data-conlet-id", conletId);
        } else {
            container = $(container);
            this._execOnUnload(container, true);
        }
        if (sticky) {
            container.removeClass('conlet-deleteable')
        } else {
            container.addClass('conlet-deleteable')
        }
        this._renderer.updateConletPreview(isNew, container[0], modes,
            content, foreground);
        this._execOnLoad(container, !isNew);
    };

    _updateView(conletType, conletId, modes, content, foreground) {
        let container = this._renderer.findConletView(conletId);
        let isNew = !container;
        if (isNew) {
            container = this._viewTemplate.clone();
            container.attr("data-conlet-type", conletType);
            container.attr("data-conlet-id", conletId);
        } else {
            container = $(container);
            this._execOnUnload(container, true);
        }
        this._renderer.updateConletView(isNew, container[0], modes,
            content, foreground);
        this._execOnLoad(container, !isNew);
    };

    _execOnLoad(container, isUpdate) {
        container.find("[data-jgwc-on-load]").each(function() {
            let onLoad = $(this).data("jgwc-on-load");
            let segs = onLoad.split(".");
            let obj = window;
            while (obj && segs.length > 0) {
                obj = obj[segs.shift()];
            }
            if (obj && typeof obj === "function") {
                obj(this, isUpdate);
            } else {
                Log.warn('Specified jgwc-on-load function "' 
                    + onLoad + '" not found.');
            }
        });
    }

    _execOnUnload(container, isUpdate) {
        container.find("[data-jgwc-on-unload]").each(function() {
            let onUnload = $(this).data("jgwc-on-unload");
            let segs = onUnload.split(".");
            let obj = window;
            while (obj && segs.length > 0) {
                obj = obj[segs.shift()];
            }
            if (obj && typeof obj === "function") {
                obj(this, isUpdate);
            } else {
                Log.warn('Specified jgwc-on-unload function "' 
                    + onUnload + '" not found.');
            }
        });
    }

    /**
     * Invokes the functions defined in `data-jgwc-on-apply`
     * attributes. Must be invoked by edit dialogs when 
     * they are closed.
     * 
     * @param {HTMLElement} container the container of the edit dialog
     */
    execOnApply(container) {
        container = $(container);
        container.find("[data-jgwc-on-apply]").each(function() {
            let onApply = $(this).data("jgwc-on-apply");
            let segs = onApply.split(".");
            let obj = window;
            while (obj && segs.length > 0) {
                obj = obj[segs.shift()];
            }
            if (obj && typeof obj === "function") {
                obj($(this)[0]);
            } else {
                Log.warn('Specified jgwc-on-apply function "' 
                    + onApply + '" not found.');
            }
        });
        this._execOnUnload(container, false);
    }

    /**
     * Registers a conlet method that to be invoked if a
     * JSON RPC notification with method <code>notifyConletView</code>
     * is received.
     * 
     * @param {string} conletClass the conlet type for which
     * the method is registered
     * @param {string} methodName the method that is registered
     * @param {function} method the function to invoke
     */
    registerConletMethod(conletClass, methodName, method) {
        let classRegistry = this._conletFunctionRegistry[conletClass];
        if (!classRegistry) {
            classRegistry = {};
            this._conletFunctionRegistry[conletClass] = classRegistry;
        }
        classRegistry[methodName] = method;
    }

    // Send methods

    /**
     * Invokes the given method on the server.
     *
     * @param {string} the method
     * @param {...any} params the parameters
     */
    send(method, ...params) {
        if (params.length > 0) {
            this._webSocket.send({
                "jsonrpc": "2.0", "method": method,
                "params": params
            });
        } else {
            this._webSocket.send({ "jsonrpc": "2.0", "method": method });
        }
    }

    /**
     * Sends a notification for changing the language to the server.
     * 
     * @param {string} locale the id of the selected locale
     */
    setLocale(locale, reload) {
        this.send("setLocale", locale, reload);
    };

    /**
     * Sends a notification that requests the rendering of a conlet.
     * 
     * @param {string} conletId the conlet id
     * @param {string[]} modes the requested render mode(s)
     */
    renderConlet(conletId, modes) {
        this.send("renderConlet", conletId, modes);
    };

    /**
     * Sends a notification that requests the addition of a conlet.
     * 
     * @param {string} conletType the type of the conlet to add
     * @param {string[]} renderModes the requested render mode(s)
     */
    addConlet(conletType, renderModes) {
        renderModes.push(RenderMode.Foreground);
        this.send("addConlet", conletType, renderModes);
    };

    /**
     * Requests the removal of a conlet preview. If a view of the
     * conlet exists, it will be removed also.
     *
     * @param {string} the conlet id
     */
    removePreview(conletId) {
        let view = this._renderer.findConletView(conletId);
        if (view) {
            this._renderer.removeConletDisplays($(view).get());
            this._execOnUnload($(view), false);
        }
        let preview = this._renderer.findConletPreview(conletId);
        if (preview) {
            this._renderer.removeConletDisplays($(preview).get());
            this._execOnUnload($(preview), false);
        }
        this.send("conletDeleted", conletId, []);
    }

    /**
     * Requests the removal of a conlet view.
     *
     * @param {string} the conlet id
     */
    removeView(conletId) {
        let view = this._renderer.findConletView(conletId);
        if (!view) {
            return;
        }
        this._renderer.removeConletDisplays($(view).get());
        this._execOnUnload($(view), false);
        if (this._renderer.findConletPreview(conletId)) {
            this.send("conletDeleted", conletId, [RenderMode.View]);
        } else {
            this.send("conletDeleted", conletId, []);
        }
    }

    /**
     * Send the current console layout to the server.
     *
     * @param {string[]} previewLayout the conlet ids from top left
     * to bottom right
     * @param {string[]} tabsLayout the ids of the conlets viewable in tabs
     * @param {Object} xtraInfo extra information spcific to the 
     * console implementation
     */
    updateLayout(previewLayout, tabLayout, xtraInfo) {
        if (!theConsole.isConfigured) {
            return;
        }
        this.send("consoleLayout", previewLayout, tabLayout, xtraInfo);
    };

    /**
     * Send a notification with method <code>notifyConletModel</code>
     * and the given conlet id, method and parameters as the 
     * notification's parameters to the server.
     * 
     * @param {string} conletId the id of the conlet to send to
     * @param {string} method the method to invoke
     * @param params the parameters to send
     */
    notifyConletModel(conletId, method, ...params) {
        if (params === undefined) {
            this.send("notifyConletModel", conletId, method);
        } else {
            this.send("notifyConletModel", conletId, method, params);
        }
    };

}

var theConsole = new Console();

/**
 * Initialize the console singleton.
 * 
 * @memberof JGConsole
 */
JGConsole.init = function(...params) {
    theConsole.init(...params);
}

/**
 * Delegates to {@link Console#registerConletMethod}.
 * 
 * @memberof JGConsole
 */
JGConsole.registerConletMethod = function(...params) {
    theConsole.registerConletMethod(...params);
}

/**
 * Delegates to {@link Console#notifyConletModel}.
 * 
 * @memberof JGConsole
 */
JGConsole.notifyConletModel = function(...params) {
    return theConsole.notifyConletModel(...params);
}

/**
 * Delegates to {@link Console#lockMessageQueue}.
 * 
 * @memberof JGConsole
 */
JGConsole.lockMessageQueue = function(...params) {
    theConsole.lockMessageQueue(...params);
}

/**
 * Delegates to {@link Console#unlockMessageQueue}.
 * 
 * @memberof JGConsole
 */
JGConsole.unlockMessageQueue = function(...params) {
    theConsole.unlockMessageQueue(...params);
}

/**
 * Delegates to the console's {@link JGConsole.Renderer#findConletPreview}.
 * 
 * @memberof JGConsole
 */
JGConsole.findConletPreview = function(...params) {
    return theConsole.renderer.findConletPreview(...params);
}

/**
 * Delegates to the console's {@link JGConsole.Renderer#findConletView}.
 * 
 * @memberof JGConsole
 */
JGConsole.findConletView = function(...params) {
    return theConsole.renderer.findConletView(...params);
}

/**
 * Delegates to the console's {@link JGConsole.Renderer#notification}.
 * 
 * @memberof JGConsole
 */
JGConsole.notification = function(content, options = {}) {
    return theConsole.renderer.notification(content, options);
}

/**
 * Generates a UUID. 
 * @return {string}
 * @memberof JGConsole
 */
JGConsole.uuid = function() {
    var r = crypto.getRandomValues(new Uint8Array(16));
    r[6] = r[6] & 0x0f | 0x40;
    r[8] = r[8] & 0x3f | 0x80;
    return (r[0].toString(16) + r[1].toString(16) +
        r[2].toString(16) + r[3].toString(16) +
        "-" + r[4].toString(16) + r[5].toString(16) +
        "-" + r[6].toString(16) + r[7].toString(16) +
        "-" + r[8].toString(16) + r[9].toString(16) +
        "-" + r[0].toString(10) + r[0].toString(11) +
        r[0].toString(12) + r[0].toString(13) +
        r[0].toString(14) + r[0].toString(15));
};

/**
 * Finds the lang specific item in a map of items by language.
 * The function first tests for a property as specified by lang,
 * then removes any trailing "-..." from lang and tries again.
 * If not successful, it tests for an entry using "en" and 
 * if still no match is found it returns null. 
 * 
 * @param {Object} items the messages by language identifier
 * @param {string} lang the language identifier
 * @param {string} fallback fallback language (defaults to 'en')
 * @return {Object}
 * @memberof JGConsole
 */
JGConsole.forLang = function(items, lang, fallback = 'en') {
    if (lang in items) {
        return items[lang];
    }
    let dashPos = lang.lastIndexOf("-");
    if (dashPos > 0) {
        return JGConsole.forLang(items, lang.substring(0, dashPos), fallback);
    }
    if (fallback && lang != fallback) {
        return JGConsole.forLang(items, fallback, fallback);
    }
    return null;
}

/**
 * Localizes the given key, using the provided localizations and language.
 *
 * First, the implementation looks up a mapping using 
 * `forLang(l10ns, lang, fallback)`. Then it looks for an entry for `key`.
 * If none is found, it returns the value of key.
 * 
 * @param {Object} l10ns the mappings by language identifier
 * @param {string} lang the language identifier
 * @param {string} key the key to look up
 * @param {string} fallback fallback language (defaults to 'en')
 * @return {Object}
 * @memberof JGConsole
 */
JGConsole.localize = function(l10ns, lang, key, fallback = 'en') {
    let langMsgs = this.forLang(l10ns, lang, fallback) || {};
    let result = langMsgs[key] || key;
    return result;
}

/**
 * Returns the data (`data-*` Attribute) of the specified
 * element with the given key. If it does not exist, it
 * set to the value provided by the supplier function.
 * 
 * @param {Object} node - the DOM element
 * @param {string} key - the key of the data
 * @param {Object} supplier - the supplier function
 * @returns {Object} the data
 * 
 * @memberof JGConsole
 */
JGConsole.createIfMissing = function(node, key, supplier) {
    let data = node.data(key);
    if (data) {
        return data;
    }
    data = supplier();
    node.data(key, data);
    return data;
}

/**
 * A generic controller for tables. It provides information about
 * the available columns and maintains state regarding their
 * sort order and direction. In addition, it supports simple
 * filtering based on cell content.
 */
export class TableController {

    /**
     * Creates a new controller for a table with the given numer
     * of columns.
     * 
     * @param {string[][]} columns - the columns as a list
     *     of pairs of column key and column label. Labels
     *     may be functions which are invoked with the table controller
     *     as this and the key as argument if a label is required.
     * @param {string} options.sortKey - the initial sort key
     * @param {string} options.sortOrder - the initial sort order
     */
    constructor(columns, options) {
        this.keys = [];
        this.labelsByKey = {};
        for (let i in columns) {
            this.keys.push(columns[i][0]);
            this.labelsByKey[columns[i][0]] = columns[i][1];
        }
        this.sortKey = '';
        this.sortOrders = {};
        for (let i in this.keys) {
            this.sortOrders[this.keys[i]] = 1;
        }
        this.filterKey = '';
        if (options) {
            if ("sortKey" in options) {
                this.sortBy(options.sortKey);
            }
            if ("sortOrder" in options) {
                this.sortBy(this.sortKey, options.sortOrder);
            }
        }
    }

    /**
     * Returns the column label for the given column key.
     * 
     * @param {string} key - the column key
     */
    label(key) {
        let label = this.labelsByKey[key];
        if (typeof label === 'function') {
            return label.call(this, key);
        }
        return label;
    }

    /**
     * Returns the sort order of the column with the given key
     * (1 for "up" and -1 for "down").
     * 
     * @param {string} key - the column key
     */
    sortOrder(key) {
        return this.sortOrders[key];
    }

    /**
     * This method sets the primary sort key. If the order is
     * `undefined`, and the current sort key is the same as the
     * specified key, the current sort order is inverted.
     * 
     * @param {string} key - the column key
     * @param {number} order - the sort order (1 for ascending 
     *     and -1 for descending) or `undefined`
     */
    sortBy(key, order) {
        if (this.sortKey != key) {
            this.sortKey = key;
        }
        else {
            this.sortOrders[key] = this.sortOrders[key] * -1;
        }
        if (typeof order !== 'undefined') {
            if (order === 'up') {
                this.sortOrders[key] = 1;
            }
            if (order === 'down') {
                this.sortOrders[key] = -1;
            }
        }
    }

    /**
     * Returns `true` if given key is the current sort key 
     * and the current sort order for is ascending.
     * 
     * @param {string} key - the column key
     */
    sortedByAsc(key) {
        return this.sortKey == key && this.sortOrders[key] == 1;
    }

    /**
     * Returns `true` if given key is the current sort key 
     * and the current sort order for is descending.
     * 
     * @param {string} key - the column key
     */
    sortedByDesc(key) {
        return this.sortKey == key && this.sortOrders[key] == -1;
    }

    /**
     * Sort and filter the given data according to the current state
     * of the controller. Returns the sorted data.
     */
    filter(data) {
        let filterKey = this.filterKey && this.filterKey.toLowerCase();
        if (filterKey) {
            data = data.filter(function(item) {
                return Object.values(item).some(function(value) {
                    return String(value).toLowerCase().indexOf(filterKey) > -1;
                });
            });
        }
        if (this.sortKey) {
            let sortKey = this.sortKey;
            let order = this.sortOrders[sortKey];
            data = data.sort(function(a, b) {
                a = a[sortKey];
                b = b[sortKey];
                return (a === b ? 0 : a > b ? 1 : -1) * order;
            });
        }
        return data;
    }

    /**
     * Sets a filter for the data.
     * 
     * @param {string} filter - the string to match
     */
    filterBy(filter) {
        this.filterKey = filter;
    }

    /**
     * A convenience method to update the filter from the
     * value of the passed in event.
     * 
     * @param {Object} event - the event which must provide
     *     a value for `$(event.target).val()`. 
     */
    updateFilter(event) {
        this.filterKey = $(event.target).val();
    }

    /**
     * A convenience method for clearing an input element
     * that is used to specify a filter. Searches for 
     * an `input` element in the `event.target`'s enclosing
     * `form` element and sets its value to the empty string.
     * 
     * @param {Object} event - the event 
     */
    clearFilter(event) {
        let form = $(event.target).closest("form");
        let input = form.find("input");
        input.val('');
        this.filterKey = '';
    }

    /**
     * A convenience function that inserts word breaks
     * (`&#x200b`) before every dot in the given text
     * and returns the result.
     * 
     * @param {string} text - the text
     */
    breakBeforeDots(text) {
        return String(text).replace(/\./g, "&#x200b;.");
    }
}

/**
 * Make class OptionsSet available as property of JGConsole.
 */
JGConsole.TableController = TableController;


/**
 * Helps to manage options. The main addition to simply using
 * a Set are the toggle functions and the support for temporarily
 * disabling an option.
 */
export class OptionsSet {

    /**
     * Creates a new option set.
     */
    constructor() {
        this.enabled = new Map();
        this.disabled = new Map();
    }

    /**
     * Sets the option with the associated value.
     * 
     * @param {string} name - the option's name
     * @param {string} value - the option's value
     */
    set(name, value) {
        this.enabled.set(name, value);
        this.disabled.delete(name);
    }

    /**
     * Returns the value of the given name.
     * 
     * @param {string} name - the option's name
     */
    get(name) {
        return this.enabled.get(name);
    }

    /**
     * Returns the names of all enabled options.
     */
    getEnabled() {
        return this.enabled.keys();
    }

    /**
     * Returns the names of all disabled options.
     */
    getDisabled() {
        return this.disabled.keys();
    }

    /**
     * Returns the names of all options.
     */
    getAll() {
        return (new Set([...this.enabled.keys(), ...this.disabled.keys()]))
            .values();
    }

    /**
     * Clears the option set.
     */
    clear() {
        this.enabled.clear();
        this.disabled.clear();
    }

    /**
     * Deletes the option with the given name.
     * 
     * @param {string} name - the option's name
     */
    delete(name) {
        this.enabled.delete(name);
        this.disabled.delete(name);
    }

    /**
     * Disables the option with the given name. The option
     * and its value are kept and can be re-enabled.
     * 
     * @param {string} name - the option's name
     */
    disable(name) {
        if (this.enabled.has(name)) {
            this.disabled.set(name, this.enabled.get(name));
            this.enabled.delete(name);
        }
    }

    /**
     * Re-enables the option with the given name.
     * 
     * @param {string} name - the option's name
     */
    enable(name) {
        if (this.disabled.has(name)) {
            this.enabled.set(name, this.disabled.get(name));
            this.disabled.delete(name);
        }
    }

    /**
     * Toggles the option with the given name, i.e. enables
     * it if it is disabled and disables it if it is enabled.
     * 
     * @param {string} name - the option's name
     */
    toggleEnabled(name) {
        if (this.enabled.has(name)) {
            this.disable(name);
        } else {
            this.enable(name);
        }
    }

    /**
     * Sets the option with the given name if it is not
     * set and deletes it if it is enabled.
     * 
     * @param {string} name - the option's name
     * @param {string} value - the option's value
     */
    toggleIsSet(name, value) {
        if (this.enabled.has(name)) {
            this.enabled.delete(name);
        } else {
            this.enabled.set(name, value);
        }
    }
}

/**
 * Make class OptionsSet available as property of JGConsole.
 */
JGConsole.OptionsSet = OptionsSet;



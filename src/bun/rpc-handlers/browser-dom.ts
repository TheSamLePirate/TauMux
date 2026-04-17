import type { Handler, HandlerDeps } from "./types";
import { SNAPSHOT_SCRIPT } from "./shared";

/** browser.* handlers that inject JS into the target webview for DOM
 *  inspection and interaction. All of these go through
 *  `dispatch("browser.evalJs", ...)` and, for the async variants, await
 *  a callback registered in `pendingBrowserEvals`. */
export function registerBrowserDom(deps: HandlerDeps): Record<string, Handler> {
  const { dispatch, pendingBrowserEvals } = deps;

  return {
    "browser.click": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.click()`,
      });
      if (params["snapshot_after"])
        dispatch("browser.evalJs", {
          surfaceId: id,
          script: SNAPSHOT_SCRIPT,
          reqId: `snap:${Date.now()}`,
        });
      return "OK";
    },

    "browser.dblclick": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.hover": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));e.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.focus": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });
      return "OK";
    },

    "browser.check": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e&&!e.checked){e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.uncheck": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e&&e.checked){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.scroll_into_view": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior:'smooth',block:'center'})`,
      });
      return "OK";
    },

    "browser.type": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const text = (params["text"] as string) ?? "";
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.focus();var t=${JSON.stringify(text)};for(var i=0;i<t.length;i++){e.dispatchEvent(new KeyboardEvent('keydown',{key:t[i],bubbles:true}));e.dispatchEvent(new KeyboardEvent('keypress',{key:t[i],bubbles:true}));e.dispatchEvent(new InputEvent('input',{data:t[i],inputType:'insertText',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:t[i],bubbles:true}));}if('value' in e)e.value+=t;e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.fill": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const text = (params["text"] as string) ?? "";
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.focus();e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.press": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const key = params["key"] as string;
      if (!id || !key) throw new Error("surface_id and key required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var k=${JSON.stringify(key)};document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keypress',{key:k,bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));})()`,
      });
      return "OK";
    },

    "browser.select": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      const value = params["value"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){e.value=${JSON.stringify(value ?? "")};e.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
      });
      return "OK";
    },

    "browser.scroll": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const selector = params["selector"] as string | undefined;
      const dx = Number(params["dx"] ?? 0);
      const dy = Number(params["dy"] ?? 0);
      const target = selector
        ? `document.querySelector(${JSON.stringify(selector)})`
        : `window`;
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `${target}.scrollBy(${dx},${dy})`,
      });
      return "OK";
    },

    "browser.highlight": (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const selector = params["selector"] as string;
      if (!id || !selector) throw new Error("surface_id and selector required");
      dispatch("browser.evalJs", {
        surfaceId: id,
        script: `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(e){var prev=e.style.outline;e.style.outline='3px solid #ff0000';e.style.outlineOffset='2px';setTimeout(function(){e.style.outline=prev;e.style.outlineOffset='';},3000);}})()`,
      });
      return "OK";
    },

    "browser.get": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const what = params["what"] as string;
      if (!id || !what) throw new Error("surface_id and what required");
      const selector = params["selector"] as string | undefined;
      const attr = params["attr"] as string | undefined;
      const prop = params["property"] as string | undefined;

      let script: string;
      switch (what) {
        case "title":
          script = `document.title`;
          break;
        case "url":
          script = `window.location.href`;
          break;
        case "text":
          script = selector
            ? `(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`
            : `document.body.innerText`;
          break;
        case "html":
          script = selector
            ? `(document.querySelector(${JSON.stringify(selector)})?.innerHTML || '')`
            : `document.documentElement.outerHTML`;
          break;
        case "value":
          script = `(document.querySelector(${JSON.stringify(selector ?? "")})?.value || '')`;
          break;
        case "attr":
          script = `(document.querySelector(${JSON.stringify(selector ?? "")})?.getAttribute(${JSON.stringify(attr ?? "")}) || '')`;
          break;
        case "count":
          script = `document.querySelectorAll(${JSON.stringify(selector ?? "")}).length`;
          break;
        case "box":
          script = `(function(){var e=document.querySelector(${JSON.stringify(selector ?? "")});if(!e)return null;var r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height});})()`;
          break;
        case "styles":
          script = prop
            ? `getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")}))?.getPropertyValue(${JSON.stringify(prop)})`
            : `JSON.stringify(Object.fromEntries([...getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")}))].map(p=>[p,getComputedStyle(document.querySelector(${JSON.stringify(selector ?? "")})).getPropertyValue(p)])))`;
          break;
        default:
          throw new Error(`Unknown getter: ${what}`);
      }

      const reqId = `get:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("");
          }
        }, 5000);
      });
    },

    "browser.is": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      const check = params["check"] as string;
      const selector = params["selector"] as string;
      if (!id || !check || !selector)
        throw new Error("surface_id, check, and selector required");

      let script: string;
      switch (check) {
        case "visible":
          script = `(function(){var e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'false';var r=e.getBoundingClientRect();var s=getComputedStyle(e);return String(r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none');})()`;
          break;
        case "enabled":
          script = `String(!document.querySelector(${JSON.stringify(selector)})?.disabled)`;
          break;
        case "checked":
          script = `String(!!document.querySelector(${JSON.stringify(selector)})?.checked)`;
          break;
        default:
          throw new Error(`Unknown check: ${check}`);
      }

      const reqId = `is:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script, reqId });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("false");
          }
        }, 5000);
      });
    },

    "browser.wait": async (params) => {
      const id =
        (params["surface_id"] as string) ?? (params["surface"] as string);
      if (!id) throw new Error("surface_id required");
      const timeoutMs = Number(params["timeout_ms"] ?? 10000);
      const selector = params["selector"] as string | undefined;
      const text = params["text"] as string | undefined;
      const urlContains = params["url_contains"] as string | undefined;
      const loadState = params["load_state"] as string | undefined;
      const fn = params["function"] as string | undefined;

      let condition: string;
      if (selector) {
        condition = `!!document.querySelector(${JSON.stringify(selector)})`;
      } else if (text) {
        condition = `document.body.innerText.includes(${JSON.stringify(text)})`;
      } else if (urlContains) {
        condition = `window.location.href.includes(${JSON.stringify(urlContains)})`;
      } else if (loadState) {
        condition =
          loadState === "complete"
            ? `document.readyState === 'complete'`
            : `document.readyState === 'interactive' || document.readyState === 'complete'`;
      } else if (fn) {
        condition = `!!(${fn})`;
      } else {
        throw new Error(
          "One of selector, text, url_contains, load_state, or function required",
        );
      }

      const pollScript = `
        (function(){
          var start=Date.now();
          var timeout=${timeoutMs};
          function check(){
            try{if(${condition}){window.__electrobunSendToHost({type:'evalResult',reqId:__reqId,result:'true'});return;}}catch(e){}
            if(Date.now()-start>timeout){window.__electrobunSendToHost({type:'evalResult',reqId:__reqId,result:'timeout'});return;}
            setTimeout(check,200);
          }
          check();
        })()
      `;

      const reqId = `wait:${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const finalScript = pollScript.replace(/__reqId/g, JSON.stringify(reqId));

      return new Promise<string>((resolve) => {
        pendingBrowserEvals?.set(reqId, resolve);
        dispatch("browser.evalJs", { surfaceId: id, script: finalScript });
        setTimeout(() => {
          if (pendingBrowserEvals?.has(reqId)) {
            pendingBrowserEvals.delete(reqId);
            resolve("timeout");
          }
        }, timeoutMs + 2000);
      });
    },
  };
}

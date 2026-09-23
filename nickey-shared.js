/* Nickey Dispatch shared utilities — V 9.6 */
(function(w){'use strict';
  w.ND_APP_VERSION='V 9.6';
  w.ndGet=function(key,fallback){try{var v=localStorage.getItem(key);return v===null?(fallback===undefined?null:fallback):JSON.parse(v);}catch(e){return fallback===undefined?null:fallback;}};
  w.ndSet=function(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){return false;}};
  w.ndGetDriver=function(){return localStorage.getItem('currentDriver')||'Unknown Driver';};
  w.ndSetDriver=function(name){localStorage.setItem('currentDriver',(name||'').trim());};
  w.eeFmtMoney=function(n){return '$'+(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});};
  w.ndSwRegisterOpts=function(){return {scope:'./',updateViaCache:'none'};};
})(window);

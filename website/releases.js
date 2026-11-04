// Orrery homepage: points the download links at the newest release on GitHub.
// Without this script (or without network) the links still go to the GitHub releases page.
(function () {
  'use strict';

  var API = 'https://api.github.com/repos/rennerdo30/orrery/releases?per_page=30';
  var REPO = 'https://github.com/rennerdo30/orrery';

  function parse(tag) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function newer(a, b) {
    for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  function pick(list) {
    var best = null, bestV = null;
    list.forEach(function (r) {
      if (r.draft || r.prerelease) return;
      var v = parse(r.tag_name);
      if (v && (!bestV || newer(v, bestV))) { best = r; bestV = v; }
    });
    return best;
  }
  function zip(r) {
    var assets = r.assets || [];
    for (var i = 0; i < assets.length; i++)
      if (/^orrery-[0-9.]+-windows-x64\.zip$/.test(assets[i].name) && assets[i].browser_download_url.indexOf(REPO + '/releases/download/') === 0)
        return assets[i].browser_download_url;
    return r.html_url;
  }

  function fill(r) {
    if (!r) return;
    var version = r.tag_name.replace(/^v/, '');
    document.querySelectorAll('[data-release="latest"]').forEach(function (el) {
      var field = el.getAttribute('data-field');
      if (field === 'found') el.hidden = false;
      if (field === 'version' || field === 'pill') el.textContent = version;
      if (field === 'date') el.textContent = new Date(r.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (field === 'download') el.href = zip(r);
      if (field === 'notes') el.href = r.html_url;
    });
  }

  if (!document.querySelector('[data-release]') || !window.fetch) return;
  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (list) { fill(pick(Array.isArray(list) ? list : [])); })
    .catch(function () { /* keep the static links */ });
})();

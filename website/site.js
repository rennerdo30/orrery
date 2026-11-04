// Orrery homepage: the "try a bone name" row. Same rules as the app (assets/viewer.js, keyOf/keyVariants):
// lower case, namespaces like "Armature|" or "mixamorig:" cut, everything but letters and digits removed,
// and known rig prefixes (mixamorig, armature, bip001, bip01, skeleton) also tried without the prefix.
(function () {
  'use strict';
  var input = document.querySelector('[data-bone-in]');
  var out = document.querySelector('[data-bone-out]');
  if (!input || !out) return;
  var PREFIXES = ['mixamorig', 'armature', 'bip001', 'bip01', 'skeleton'];
  function variants(name) {
    var k = name.toLowerCase().replace(/^.*[|:]/, '').replace(/[^a-z0-9]/g, '');
    var list = [k];
    PREFIXES.forEach(function (p) { if (k.indexOf(p) === 0 && k.length > p.length) list.push(k.slice(p.length)); });
    return list;
  }
  function update() {
    var v = variants(input.value.trim());
    out.textContent = v[0] ? v.join(' or ') : '(empty)';
  }
  input.addEventListener('input', update);
  update();
})();

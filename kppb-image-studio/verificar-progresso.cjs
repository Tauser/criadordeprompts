const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/studio-workflows.js', 'utf8');
const start = source.indexOf('function showGenerationProgress(');
const end = source.indexOf('\nfunction appendImageComparison(', start);
const nodes = new Map();
function $(id) {
  if (!nodes.has(id)) nodes.set(id, {textContent: '', hidden: true, value: 0,
    classList: {toggle(_, hidden) {nodes.get(id).hidden = hidden;}},
    removeAttribute(name) {delete this[name];}});
  return nodes.get(id);
}
const context = vm.createContext({$, Number, Math});
vm.runInContext(source.slice(start, end), context);
const show = context.showGenerationProgress;
show({status: 'running', kind: 'image', progress: {phase: 'sampling', percent: 45, value: 18, maximum: 40}});
assert.equal($('generationProgressPercent').textContent, '45%');
assert.equal($('generationProgressBar').value, 45);
assert.match($('generationProgressHint').textContent, /Passo 18 de 40/);
show({status: 'running', kind: 'image', progress: {phase: 'decoding', percent: 100}});
assert.match($('generationProgressLabel').textContent, /Decodificando/);
show({status: 'running', kind: 'refine', progress: {percent: 75}});
assert.equal($('generationProgressPercent').textContent, '');
assert.equal('value' in $('generationProgressBar'), false);
show({status: 'queued'}); assert.equal($('generationProgress').hidden, true);
show({status: 'error'}); assert.equal($('generationProgress').hidden, true);
show({status: 'completed', kind: 'refine'}); assert.equal($('generationProgress').hidden, true);
show({status: 'completed', kind: 'image'});
assert.equal($('generationProgressPercent').textContent, '100%');
assert.equal($('generationProgress').hidden, false);
show({status: 'running', kind: 'image'});
assert.equal($('generationProgressPercent').textContent, '');
assert.equal('value' in $('generationProgressBar'), false);
console.log('OK porcentagem, etapas, fila, erros, aprimoramento e progresso indeterminado');

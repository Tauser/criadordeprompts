const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/KPPB_Image_Studio_v5_1.html', 'utf8');
const catalog = fs.readFileSync(__dirname + '/textos-prompts.js', 'utf8');
const js = catalog + '\n' + html.split('<script>')[1].split('</script>')[0];
new vm.Script(js);
class Element {
  constructor(value = '') {
    this.value = value; this.id = ''; this.checked = false; this.disabled = false;
    this.title = ''; this.textContent = value; this.innerHTML = ''; this.dataset = {};
    this.children = []; this.classList = {toggle(){}};
  }
  querySelectorAll() { return this.children; }
  querySelector(selector) {
    if (selector.startsWith('option')) return this.children.find(x => x.value === '');
    const value = selector.match(/value="([^"]+)"/)[1];
    return this.children.find(x => x.value === value);
  }
  contains(target) { return this.children.includes(target); }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(x => x.value === this.value); }
}
const nodes = new Map();
const $ = id => {
  if (!nodes.has(id)) { const node = new Element(); node.id = id; nodes.set(id, node); }
  return nodes.get(id);
};
function group(id, values) { $(id).children = values.map(value => new Element(value)); }
group('editOps', ['wardrobe','environment','pose','action','expression','lighting','hair']);
group('preserves', ['face','body','skin','hair','pose','clothes','environment','lighting']);
group('sourceSupports', ['floor','chair','sofa','bed','bench','wall']);
group('editPose', ['', 'neutral', 'walking', 'seated', 'custom']);
const picked = id => $(id).children.filter(x => x.checked).map(x => x.value);
const box = (id, value) => $(id).children.find(x => x.value === value);
Object.entries({editWardrobe:'casual',editPose:'walking',editLocation:'forest',
  sourceCrop:'full',poseFraming:'reframe',poseSupport:'preserve',shot:'auto',light:'soft',
  subject:'woman',environment:'loft',wardrobe:'casual',pose:'neutral',action:'none'}).forEach(([id,value]) => $(id).value = value);
const context = vm.createContext({$, val:id=>$(id).value, picked, app:{mode:'edit'}, Map, Set, refreshLanguage:()=>{}});
const run = source => vm.runInContext(source, context);
run(js.slice(js.indexOf('const poseRules ='), js.indexOf('const operationConflicts =')));
run(js.slice(js.indexOf('const operationConflicts ='), js.indexOf('function getEditStrategy()')));
run(js.slice(js.indexOf('function activateEditOperation('), js.indexOf('const manualPrompts =')));
let count = 0;
function test(name, action) { action(); count++; console.log('OK ' + name); }
context.target = null;
const sync = target => { context.target = target; run('syncLinkedControls(target)'); };
test('Escolher pose ativa alteração e desativa preservar a pose original', () => {
  box('preserves','pose').checked = true;
  sync($('editPose'));
  assert(box('editOps','pose').checked);
  assert(!box('preserves','pose').checked);
  assert(box('preserves','pose').disabled);
  assert($('shot').disabled);
});
test('Desmarcar alteração restaura a preferência de preservação e enquadramento', () => {
  box('editOps','pose').checked = false; sync();
  assert(box('preserves','pose').checked);
  assert(!box('preserves','pose').disabled);
  assert(! $('shot').disabled);
});
test('Novo ambiente respeita apoios preservados; permitir novos apoios libera o filtro', () => {
  $('supportsKnown').checked = true; box('sourceSupports','chair').checked = true;
  sync($('editPose')); sync($('editLocation'));
  assert(! $('supportsKnown').disabled);
  assert(!box('sourceSupports','chair').disabled);
  $('poseSupport').value='add';sync();
  assert($('supportsKnown').disabled);
  assert(box('sourceSupports','chair').checked);
  $('poseSupport').value='preserve';
  box('editOps','environment').checked = false; sync();
  assert(! $('supportsKnown').disabled);
  assert(!box('sourceSupports','chair').disabled);
});
test('Pose incompatível continua selecionada, mas não integra operações executáveis', () => {
  $('editPose').value = 'walking'; $('sourceCrop').value = 'portrait'; $('poseFraming').value = 'preserve';
  sync(); run('syncPoseOptions()');
  assert.equal($('editPose').value, 'walking');
  assert(box('editPose','walking').disabled);
  assert(!run('activeOperations()').includes('pose'));
  $('poseFraming').value = 'reframe'; $('supportsKnown').checked = false;
  sync(); run('syncPoseOptions()');
  assert(!box('editPose','walking').disabled);
  assert(run('activeOperations()').includes('pose'));
});
test('Iluminação da edição atualiza o valor usado pela composição e ativa a operação', () => {
  $('editLight').value = 'golden'; sync($('editLight'));
  assert.equal($('light').value,'golden'); assert(box('editOps','lighting').checked);
  $('light').value = 'studio'; sync($('light'));
  assert.equal($('editLight').value, 'studio');
});
test('Textos separados carregam os presets sem usar o campo português', () => {
  const data = vm.createContext({}); vm.runInContext(catalog,data);
  assert(vm.runInContext("dict.env.forest[0].includes('forest')",data));
  assert(html.includes('src="textos-prompts.js"'));
  assert(!html.includes('id="outputPt"'));
  assert(!html.includes('id="sendLanguage"'));
});
test('Tabelas exigidas na inicialização existem e apontam para presets válidos', () => {
  const data = vm.createContext({}); vm.runInContext(catalog,data);
  for (const [table,category] of [['newEnvironments','env'],['newOutfits','wardrobe'],['newExpressions','expressions'],['outfitNames','wardrobe']]) {
    const result=vm.runInContext(`Object.entries(${table}).every(([key,label])=>typeof label==='string'&&Array.isArray(dict.${category}[key])&&typeof dict.${category}[key][0]==='string')`,data);
    assert(result,table);
  }
});
test('Opção personalizada exige instrução em inglês', () => {
  run("app.mode='generate'"); $('environment').value='custom';
  assert.equal(run('validateLinkedInputs().field'),'customEn');
  $('customEn').value='Add a plant in the background.';
  assert.equal(run('validateLinkedInputs()'),null);
  $('customEn').value=''; $('environment').value='loft';run("app.mode='edit'");
});
test('Roupa personalizada exige descrição própria no idioma de envio', () => {
  $('editWardrobe').value = 'custom'; sync($('editWardrobe'));
  assert(! $('wardrobeEn').disabled);
  assert.equal(run('validateLinkedInputs().field'), 'wardrobeEn');
  $('wardrobeEn').value = 'Green shirt and white trousers.';
  assert.equal(run('validateLinkedInputs()'), null);
  box('editOps','wardrobe').checked = false; sync();
  assert(! $('wardrobeEn').disabled);
});
test('Descrição livre continua editável com a operação desmarcada e digitar reativa a troca', () => {
  assert.equal($('editWardrobe').value, 'custom');
  assert(!box('editOps','wardrobe').checked);
  $('wardrobeEn').value = 'Blue shirt and beige trousers.'; sync($('wardrobeEn'));
  assert(box('editOps','wardrobe').checked);
  assert.equal(run('validateLinkedInputs()'), null);
  $('editWardrobe').value = 'casual'; sync($('editWardrobe'));
  assert($('wardrobeEn').disabled);
});
test('Ambiente personalizado precisa de instrução e não usa silenciosamente outro preset', () => {
  $('editLocation').value = 'custom'; sync($('editLocation'));
  assert.equal(run('validateLinkedInputs().field'),'customEn');
  $('customEn').value = 'A garden with a stone fountain.';
  assert.equal(run('validateLinkedInputs()'), null);
});
test('Escolher ação ativa a edição e desativa a pose rígida; desligar restaura',()=>{
  box('editOps','pose').checked=false;sync();box('preserves','pose').checked=true;
  $('editAction').value='wave';sync($('editAction'));
  assert(box('editOps','action').checked);assert(!box('preserves','pose').checked);assert(box('preserves','pose').disabled);
  box('editOps','action').checked=false;sync();assert(box('preserves','pose').checked);assert(!box('preserves','pose').disabled);
});
test('Manter ação original desativa a operação sem exigir seleção',()=>{
  $('editAction').value='none';sync($('editAction'));assert(!box('editOps','action').checked);
  box('editOps','action').checked=true;assert.equal(run('validateLinkedInputs()'),null);
  assert(!run('activeOperations()').includes('action'));sync();assert(!box('editOps','action').checked);
  assert(!box('preserves','pose').disabled);
});
test('Personagem fixo mantém aparência sem travar pose e restaura preferências ao desfixar',()=>{
  for(const op of $('editOps').children)op.checked=false;
  box('preserves','face').checked=false;box('preserves','body').checked=true;
  box('preserves','skin').checked=true;box('preserves','hair').checked=false;
  context.app.characterReference={file:{}};sync();
  for(const key of ['face','body','skin','hair']){
    assert(box('preserves',key).checked);assert(box('preserves',key).disabled);
  }
  sync($('editPose'));assert(box('editOps','pose').checked);assert(!box('preserves','pose').checked);
  context.app.characterReference=null;sync();
  assert(!box('preserves','face').checked);assert(box('preserves','body').checked);
  assert(!box('preserves','hair').checked);assert(!box('preserves','body').disabled);
});
test('Ação facial mantém a preservação da postura e gesto corporal recupera a regra flexível',()=>{
  for(const op of $('editOps').children)op.checked=false;
  $('editAction').value='basic:smile';
  context.selectedEditAction=()=>box('editOps','action').checked?{expression:true}:null;
  box('preserves','pose').checked=true;sync($('editAction'));
  assert(box('preserves','pose').checked);assert(!box('preserves','pose').disabled);
  assert(run('getActualPreserve()').includes('pose'));
  assert(!box('editOps','pose').checked);
  context.selectedEditAction=()=>box('editOps','action').checked?{expression:false}:null;
  $('editAction').value='wave';sync($('editAction'));
  assert(!box('preserves','pose').checked);assert(box('preserves','pose').disabled);
  assert(!run('getActualPreserve()').includes('pose'));
  box('editOps','action').checked=false;sync();
  assert(box('preserves','pose').checked);assert(!box('preserves','pose').disabled);
  delete context.selectedEditAction;
});
test('Apoios ficam disponíveis para cenário e ação corporal sem ativar nova pose',()=>{
  for(const op of $('editOps').children)op.checked=false;
  $('editLocation').value='neutral';sync($('editLocation'));run('syncPoseOptions()');
  assert(! $('poseSupport').disabled);assert($('sourceCrop').disabled);assert($('poseFraming').disabled);
  assert(!box('editOps','pose').checked);assert($('supportsKnown').disabled);
  box('editOps','environment').checked=false;
  $('editAction').value='wave';
  context.selectedEditAction=()=>box('editOps','action').checked?{expression:false}:null;
  sync($('editAction'));assert(! $('poseSupport').disabled);assert(!box('editOps','pose').checked);
  context.selectedEditAction=()=>box('editOps','action').checked?{expression:true}:null;
  sync();assert($('poseSupport').disabled);
  delete context.selectedEditAction;
});
test('Trocar cenário não ignora apoio ausente quando foi escolhido manter apoios existentes',()=>{
  for(const op of $('editOps').children)op.checked=false;
  box('editOps','environment').checked=true;box('editOps','pose').checked=true;
  $('editPose').value='seated';$('poseFraming').value='reframe';
  $('supportsKnown').checked=true;$('poseSupport').value='preserve';
  for(const support of $('sourceSupports').children)support.checked=support.value==='floor';
  assert(run("poseProblems('seated')").includes('apoio necessário ausente'));
  $('poseSupport').value='add';
  assert.equal(run("poseProblems('seated')").length,0);
});
test('Referência corporal ativa preservação da aparência sem travar pose e restaura preferência ao remover',()=>{
  for(const op of $('editOps').children)op.checked=false;
  context.app.characterReference=null;context.app.refs=[];sync();
  box('preserves','body').checked=false;box('preserves','skin').checked=false;
  context.app.refs=[{file:{},role:'target'},{file:{},role:'body'}];sync();
  for(const key of ['body','skin']){
    assert(box('preserves',key).checked);assert(box('preserves',key).disabled);
    assert(box('preserves',key).title.includes('Corpo do protagonista'));
  }
  assert(!box('editOps','pose').checked);
  sync($('editPose'));assert(box('editOps','pose').checked);assert(box('preserves','body').checked);
  context.app.refs.pop();sync();
  for(const key of ['body','skin']){
    assert(!box('preserves',key).checked);assert(!box('preserves',key).disabled);
  }
});
console.log(JSON.stringify({passed:count, syntax:'valid'}));

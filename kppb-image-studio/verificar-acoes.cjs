const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const catalog = fs.readFileSync(__dirname + '/textos-prompts.js', 'utf8');
const actions = fs.readFileSync(__dirname + '/acoes-edicao.js', 'utf8');
const html = fs.readFileSync(__dirname + '/KPPB_Image_Studio_v5_1.html', 'utf8');
const nodes = new Map();
const $ = id => {
  if (!nodes.has(id)) nodes.set(id, {value:'', checked:false, disabled:false, children:[], append(x){this.children.push(x)},replaceChildren(...items){this.children=items}});
  return nodes.get(id);
};
Object.entries({editAction:'wave',editStrategy:'short',editPose:'neutral',poseSupport:'preserve',poseFraming:'preserve',
  shot:'auto',subject:'woman',age:'adult',environment:'studio',wardrobe:'casual',pose:'neutral',action:'none',
  camera:'auto',light:'soft',fidelity:'3'}).forEach(([id,value])=>$(id).value=value);
const state = {ops:['action'],keep:['face','body']};
const context = vm.createContext({$, val:id=>$(id).value, app:{mode:'edit',style:'real',refs:[],packs:{}},
  activeOperations:()=>state.ops, getActualPreserve:()=>state.keep.filter(k=>k!=='pose'||!state.ops.includes('action')),
  getEditStrategy:()=>$('editStrategy').value, picked:()=>[], poseRule:()=>({full:false}),
  trans:(o,k,l)=>{const entry=o[k]||o[Object.keys(o)[0]];return entry[l==='en'?0:1]},
  document:{createElement:()=>({value:'',textContent:'',children:[],append(x){this.children.push(x)}})}, update:()=>{}});
const run = code=>vm.runInContext(code,context);
run(catalog);
context.app.mode='generate';const generationBefore=run("compose('en')");context.app.mode='edit';
const directBefore=run("compose('en')");
run(actions);
let passed=0;
function test(name,callback){callback();passed++;console.log('OK '+name)}
test('Ação aparece uma vez no prompt de edição sem ordem para manter tudo intacto',()=>{
  const p=run("compose('en')");assert(p.includes('waving with the right hand raised'));
  assert.equal(p.split("Change the subject's action to:").length-1,1);
  assert(!p.includes('otherwise keep the source image unchanged'));
});
test('Trocar ação remove a anterior e acrescenta somente o objeto necessário',()=>{
  $('editAction').value='hold_mug';const p=run("compose('en')");
  assert(p.includes('holding a ceramic mug'));assert(!p.includes('waving'));
  assert(p.includes('Add only the object needed for this action.'));
});
test('Desativar ação mantém a escolha e remove a instrução do prompt',()=>{
  state.ops=[];const p=run("compose('en')");assert(!p.includes('holding a ceramic mug'));
  assert.equal($('editAction').value,'hold_mug');
});
test('Modo Geração permanece idêntico ao anterior',()=>{
  state.ops=['action'];context.app.mode='generate';assert.equal(run("compose('en')"),generationBefore);context.app.mode='edit';
});
test('Preservação detalhada permite o gesto mantendo proporções',()=>{
  $('editStrategy').value='detailed';const p=run("compose('en')");
  assert(p.includes('preserve original body proportions while allowing joint repositioning'));
});
test('Ação junto com pose não pede manter a postura anterior',()=>{
  state.ops=['pose','action'];const p=run("compose('en')");
  assert(p.includes('Fit the action to the requested pose.'));
  assert(!p.includes('keep the rest of the posture unchanged'));
});
test('Grupo de ações cotidianas mantém todas as entradas existentes',()=>{
  const group=$('editAction').children.find(x=>x.label==='Ações e gestos cotidianos');
  assert.equal(group.children.length,21);
  assert(group.children.every(x=>!x.value.startsWith('sensual:')&&!x.value.startsWith('import:')));
  assert(html.includes('"editAction",'));
});
test('Entradas básicas reutilizam literalmente os textos do portfólio',()=>{
  state.ops=['action'];$('editStrategy').value='short';$('editAction').value='basic:hair';
  const p=run("compose('en')");assert(p.includes(run('dict.actions.hair[0]')));
  assert.equal(run('editorActions["basic:hair"].prompt'),run('dict.actions.hair[0]'));
});
test('Manter ação original não acrescenta ação ao prompt',()=>{
  $('editAction').value='none';state.ops=[];const p=run("compose('en')");
  assert(!p.includes("Change the subject's action to:"));
});
test('Abraço na edição pede um parceiro ausente em vez de exigir dois já presentes',()=>{
  $('editAction').value='basic:embrace';state.ops=['action'];
  const p=run("compose('en')");
  assert(p.includes('This action requires 2 participants'));
  assert(p.includes('add only the missing distinct'));
  assert(p.includes('Reuse participants already in <image1>'));
  assert(p.includes("Preserve the original protagonist's identity"));
  assert(p.includes("Keep each person's skeleton and limbs separate"));
  assert(!p.includes('Use only the two people already present'));
});
test('Ação desligada não cria parceiro nem acrescenta anatomia de dupla',()=>{
  state.ops=[];const p=run("compose('en')");
  assert(!p.includes('This action requires'));assert(!p.includes("each person's skeleton"));
});
test('Abraço na geração com protagonista único inclui segundo adulto',()=>{
  context.app.mode='generate';$('action').value='embrace';$('subject').value='woman';
  const p=run("compose('en')");assert(p.startsWith('Primary protagonist: one fictional adult woman'));
  assert(p.includes('making 2 people in total'));assert(p.includes('Add exactly 1 distinct'));
});
test('Dois adultos já solicitados não recebem um terceiro',()=>{
  $('subject').value='two';const p=run("compose('en')");
  assert(p.includes('Use the two requested adults for this action, without adding another person'));
  assert(!p.includes('Add exactly 1 distinct'));
});
test('Personagem fixo continua exclusivo do protagonista em ação de dupla',()=>{
  context.app.mode='edit';state.ops=['action'];
  context.promptReferences=()=>[{role:'target'},{role:'character',characterSource:true}];
  const p=run("compose('en')");assert(p.includes('For the original protagonist, preserve facial identity'));
  assert(p.includes('from <image2> across pose and perspective changes'));
  delete context.promptReferences;
});
test('Todas as interações cotidianas declaradas usam a mesma regra de participantes',()=>{
  context.app.mode='edit';state.ops=['action'];
  for(const key of ['embrace','handshake','dance_pair','conversation']){
    $('editAction').value='basic:'+key;const p=run("compose('en')");
    assert.equal(run(`actionRequiredParticipants('basic:${key}')`),2);
    assert(p.includes('This action requires 2 participants'));
    assert(p.includes('add only the missing distinct'));
    assert(!p.includes('Use only the two people already present'));
  }
});
test('Contagem genérica suporta ações com três participantes sem duplicar os existentes',()=>{
  context.app.mode='generate';$('subject').value='woman';
  assert(run("participantRequirement(3,'en',false)").includes('Add exactly 2 distinct'));
  $('subject').value='two';assert(run("participantRequirement(3,'en',false)").includes('Add exactly 1 distinct'));
  $('subject').value='custom';assert(run("participantRequirement(3,'en',false)").includes('Use characters already described'));
  for(const count of [0,1,11,2.5])assert.equal(run(`participantRequirement(${count},'en',false)`),'');
});
test('Ações individuais não recebem outro personagem',()=>{
  context.app.mode='edit';state.ops=['action'];$('editAction').value='wave';
  assert(!run("compose('en')").includes('This action requires'));
});
test('Ação sem nova pose permite somente as mudanças necessárias, sem postura rígida',()=>{
  state.ops=['action'];$('editAction').value='wave';
  const p=run("compose('en')");
  assert(p.includes('Preserve the source posture wherever compatible with the action'));
  assert(!p.includes('keep the rest of the posture unchanged'));
  assert(!p.includes('Use the exact requested pose'));
  assert.deepEqual(state.ops,['action']);
});
const originalSelection=run('selectedEditAction');
test('Ação que pede sentar funciona sem ativar Alterar pose',()=>{
  context.selectedEditAction=()=>({prompt:'sitting on a chair and reading a book',prop:true});
  state.ops=['action'];$('editPose').value='neutral';
  const p=run("compose('en')");
  assert(p.includes('sitting on a chair and reading a book'));
  assert(p.includes('allow only the body position and gaze changes needed'));
  assert.equal(run('poseControlConflict()'),null);
  assert.deepEqual(state.ops,['action']);
});
test('Pose explícita incompatível aponta o campo sem sobrescrever escolhas',()=>{
  state.ops=['action','pose'];$('editPose').value='neutral';
  const conflict=run('poseControlConflict()');
  assert.equal(conflict.field,'editPose');
  assert(conflict.message.includes('sentado'));assert(conflict.message.includes('em pé'));
  assert.equal($('editPose').value,'neutral');assert.equal($('editAction').value,'wave');
  $('editPose').value='seated';assert.equal(run('poseControlConflict()'),null);
});
test('Descrições ambíguas não viram uma exigência de postura adivinhada',()=>{
  for(const text of ['waving at the camera','two adults, one standing and one sitting',
    'standing beside a person sitting on a chair','Keep the source posture'])
    assert.equal(run(`leadingBodyPosture(${JSON.stringify(text)})`),'');
  context.selectedEditAction=originalSelection;
});
test('Sorrir preserva postura sem instruções de movimentação corporal',()=>{
  state.ops=['action'];$('editAction').value='basic:smile';
  const p=run("compose('en')");
  assert(p.includes('Change only the expression and gaze'));
  assert(!p.includes('allow only the body position'));
  assert.equal(run('poseControlConflict()'),null);
});
test('Estudo artístico confirmado não recebe ordem contraditória de vestir os participantes',()=>{
  context.app.mode='edit';state.ops=['action','removeall'];state.keep=['face','body','clothes'];
  $('editAction').value='basic:handshake';$('fictionalConfirm').checked=true;
  const p=run("compose('en')");
  assert(p.includes('without clothing in a non-sexual fine-art figure study'));
  assert(!p.includes('appropriately clothed'));assert(!p.includes('original outfit'));
  assert(!p.includes('Display explicit, intimate anatomical details'));
  assert(p.includes('without emphasis on intimate anatomy'));
});
test('Confirmação desligada conserva a restrição e a regra normal de vestuário',()=>{
  $('fictionalConfirm').checked=false;const p=run("compose('en')");
  assert(p.includes('Clothing-removal request not applied'));
  assert(p.includes('appropriately clothed'));assert(!p.includes('without clothing in a non-sexual'));
});
test('Opção artística guardada mas desativada não muda a roupa da ação',()=>{
  $('fictionalConfirm').checked=true;$('editWardrobe').value='figure_study';state.ops=['action'];
  const p=run("compose('en')");assert(p.includes('appropriately clothed'));
  assert(!p.includes('without clothing in a non-sexual'));
});
test('As duas operações artísticas usam a mesma instrução não explícita',()=>{
  state.ops=['wardrobe'];const fromWardrobe=run("compose('en')");
  state.ops=['removeall'];const fromOperation=run("compose('en')");
  const instruction=run("artisticFigureInstruction('en')").replace(/^- /,'');
  assert(fromWardrobe.includes(instruction));assert(fromOperation.includes(instruction));
  state.ops=[];state.keep=['face','body'];$('fictionalConfirm').checked=false;
});
console.log(JSON.stringify({passed,syntax:'valid'}));

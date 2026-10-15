// Behavioral checks use ordinary poses and gestures only; no image jobs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function studio(catalogFile) {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'',checked:false,children:[],
      append(x){this.children.push(x)},replaceChildren(...items){this.children=items}});
    return nodes.get(id);
  };
  Object.entries({editAction:'none',editPose:'seated',editExpression:'confident',editStrategy:'short',
    poseFraming:'preserve',poseSupport:'preserve',shot:'auto',light:'soft',fidelity:'3',
    pose:'seated',action:'none',subject:'woman',age:'adult',environment:'studio',wardrobe:'casual',camera:'auto'})
    .forEach(([id,value])=>$(id).value=value);
  const state = {ops:['pose'],keep:['face','body','skin','hair']};
  const context = vm.createContext({$,val:id=>$(id).value,
    app:{mode:'edit',style:'real',refs:[],packs:{poses:{prone:'lying prone, face down, with arms alongside the body'}}},
    activeOperations:()=>state.ops,getActualPreserve:()=>state.keep,getEditStrategy:()=>$('editStrategy').value,
    picked:()=>[],poseRule:()=>({full:true}),update:()=>{},
    document:{createElement:()=>({children:[],append(x){this.children.push(x)}})}});
  const run = code=>vm.runInContext(code,context);
  run(fs.readFileSync(catalogFile,'utf8'));
  run(fs.readFileSync(path.join(path.dirname(catalogFile),'acoes-edicao.js'),'utf8'));
  return {$,state,context,run,prompt:()=>run("compose('en')")};
}

const current = studio(path.join(__dirname,'textos-prompts.js'));
const {$,state,context,run,prompt} = current;
let passed = 0;
function test(name,fn){fn();passed++;console.log('OK '+name)}

test('Pose aparece uma vez, com prioridade e sem lista de autoverificação',()=>{
  const p=prompt(),target=run("getPose('seated','en')");
  assert.equal(p.split(target).length-1,1);
  assert(p.includes('Use the exact requested pose'));
  assert(!p.includes('ACCEPTANCE CHECK'));assert(!p.includes('Before finalizing'));
  assert(p.includes('Support the pelvis firmly'));
});
test('Pose para baixo mantém anatomia e aceita rosto oculto sem forçar olhar',()=>{
  $('editPose').value='import:prone';state.ops=['pose','expression'];
  const p=prompt();assert(p.includes('neck aligned with the spine'));
  assert(p.includes('allow facial occlusion'));assert(p.includes('a confident expression'));
  assert(!p.includes('eye contact'));assert(!p.includes('lifted chin'));
  assert(run('poseExpressionNotice()'));
});
test('Olhar explícito para câmera incompatível aponta o campo antes do envio',()=>{
  $('editExpression').value='looking';
  assert.equal(run('poseControlConflict()').field,'editExpression');
  $('editExpression').value='confident';$('editAction').value='basic:eye';state.ops=['pose','action'];
  assert.equal(run('poseControlConflict()').field,'editAction');
});
test('Ler mantém olhar para páginas e expressão, sem contato visual acrescentado',()=>{
  $('editPose').value='seated';$('editAction').value='read_book';$('editExpression').value='confident';
  state.ops=['pose','action','expression'];const p=prompt();
  assert(p.includes('looking down at its pages'));assert(p.includes('a confident expression'));
  assert(!p.includes('eye contact'));assert(!p.includes('lifted chin'));
  assert.equal(run('poseControlConflict()'),null);
});
test('Ler com olhos fechados ou olhar explícito para câmera aponta conflito',()=>{
  for(const expression of ['eyesclosed','looking']){
    $('editExpression').value=expression;
    assert.equal(run('poseControlConflict()').field,'editExpression');
  }
});
test('Ação de olhar sobre ombro recebe orientação de anatomia sem nova pose',()=>{
  $('editAction').value='basic:lookback';state.ops=['action'];
  const p=prompt();assert(p.includes('Turn neck, shoulders and upper torso together'));
  assert(!p.includes('Use the exact requested pose'));
});
test('Ação desligada não herda olhar, gesto ou pose selecionados',()=>{
  state.ops=['expression'];$('editPose').value='import:prone';$('editExpression').value='confident';
  assert(prompt().includes('steady eye contact'));assert.equal(run('poseControlConflict()'),null);
});
test('Enquadramento escolhido não recebe ordem extra para mudar a câmera',()=>{
  state.ops=['pose'];$('editPose').value='seated';const p=prompt();
  assert(p.includes('Preserve the original framing as much as anatomy allows'));
  assert(!p.includes('Adapt camera and framing to the body'));
});
test('Instrução personalizada permanece literalmente no prompt',()=>{
  const custom='Keep the blue notebook in the left hand. Do not change its cover.';
  $('customEn').value=custom;assert(prompt().includes(custom));$('customEn').value='';
});
test('Geração não pede substituir uma postura de origem inexistente',()=>{
  context.app.mode='generate';const p=prompt();
  assert(!p.includes('source posture'));assert(p.includes(run("getPose('seated','en')")));
  context.app.mode='edit';
});
test('Geração também detecta pose para baixo com olhar explícito para câmera',()=>{
  context.app.mode='generate';$('pose').value='import:prone';$('action').value='eye';
  assert.equal(run('poseControlConflict()').field,'action');
  $('action').value='none';assert.equal(run('poseControlConflict()'),null);
  $('pose').value='seated';context.app.mode='edit';
});
test('Validação do envio consulta conflitos dos controles',()=>{
  const html=fs.readFileSync(path.join(__dirname,'KPPB_Image_Studio_v5_1.html'),'utf8');
  const source=html.match(/function validateLinkedInputs\(\) \{[\s\S]*?^      \}/m)[0];
  run(source);$('editExpression').value='looking';$('editPose').value='import:prone';state.ops=['pose','expression'];
  context.picked=()=>state.ops;assert.equal(run('validateLinkedInputs()').field,'editExpression');
});

test('Trocar cenário preservando pose mantém os apoios necessários sem pedir nova pose',()=>{
  state.ops=['environment'];state.keep=['face','body','pose','clothes'];
  $('editLocation').value='neutral';$('poseSupport').value='preserve';
  const p=prompt();
  assert(p.includes('Replace the background with a seamless neutral studio backdrop'));
  assert(p.includes('retaining existing support surfaces needed by the subject'));
  assert(p.includes('original pose'));assert(!p.includes('Replace the current pose'));
  assert(!p.includes('remove the old setting'));
  assert.equal(p.split('retaining existing support surfaces').length-1,1);
});
test('Permitir apoio novo no cenário não exige conservar o mobiliário antigo',()=>{
  $('poseSupport').value='add';const p=prompt();
  assert(p.includes('provide only the support surfaces needed'));
  assert(!p.includes('retaining existing support surfaces'));
});
test('Pose e cenário juntos obedecem ao apoio selecionado sem duplicar instrução',()=>{
  state.ops=['environment','pose'];$('editPose').value='seated';$('poseSupport').value='preserve';
  let p=prompt();assert(p.includes('retaining existing support surfaces'));
  assert(!p.includes('Use plausible support for the requested pose'));
  $('poseSupport').value='add';p=prompt();
  assert(p.includes('provide only the support surfaces needed'));
  assert.equal(p.split('provide only the support surfaces needed').length-1,1);
  state.ops=['expression'];assert(!prompt().includes('support surfaces needed'));
  $('poseSupport').value='preserve';
  state.keep=['face','body','skin','hair'];
});

test('Ação corporal pode adicionar apoio sem ativar pose e ação facial não recebe apoio',()=>{
  state.ops=['action'];$('editAction').value='read_book';$('poseSupport').value='add';
  let p=prompt();assert(p.includes('Use plausible support for the action'));
  assert(!p.includes('Replace the current pose'));assert(!p.includes('Use the exact requested pose'));
  $('editAction').value='basic:smile';p=prompt();assert(!p.includes('Use plausible support'));
  $('poseSupport').value='preserve';$('editAction').value='none';
});

test('Pose de costas permite rosto oculto sem acrescentar contato visual à expressão',()=>{
  context.app.packs.poses.rear='standing with back to the camera, arms relaxed';
  $('editPose').value='import:rear';$('editExpression').value='confident';state.ops=['pose','expression'];
  const p=prompt();
  assert(p.includes('Keep head and torso in a compatible orientation'));
  assert(p.includes('An identity reference does not require a frontal face'));
  assert(p.includes('a confident expression'));assert(!p.includes('steady eye contact'));assert(!p.includes('lifted chin'));
  assert.equal(run('poseControlConflict()'),null);
});
test('Corpo de costas e olhar frontal explícito apontam conflito em expressão ou ação',()=>{
  $('editExpression').value='looking';
  assert.equal(run('poseControlConflict()').field,'editExpression');
  $('editAction').value='basic:eye';state.ops=['pose','action'];
  assert.equal(run('poseControlConflict()').field,'editAction');
});
test('Giro explícito sobre o ombro usa pescoço e tronco juntos sem proibir rosto visível',()=>{
  $('editAction').value='basic:lookback';$('editExpression').value='looking';state.ops=['pose','action','expression'];
  const p=prompt();assert(p.includes('Turn neck, shoulders and upper torso together'));
  assert.equal(run('poseControlConflict()'),null);
});
test('Desativar pose de costas retira suas regras e mantém apenas orientação da ação ativa',()=>{
  state.ops=['expression'];$('editExpression').value='confident';
  assert(!prompt().includes('An identity reference does not require a frontal face'));
  assert(prompt().includes('steady eye contact'));
  assert.equal(run('poseControlConflict()'),null);
});

const backupRoot=path.join(__dirname,'../backups');
const previous=(fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot) : []).filter(name=>name.startsWith('poses-concisas-')).sort().at(-1);
if(previous){
  const before=studio(path.join(backupRoot,previous,'textos-prompts.js'));
  // Um catálogo editado pelo usuário pode usar um snapshot anterior ao ajuste atual.
  // A comparação histórica de tamanho continua usando o prompt original abaixo.
  const dictionaryContext=vm.createContext({});
  vm.runInContext(fs.readFileSync(process.argv[2] || path.join(backupRoot,previous,'textos-prompts.js'),'utf8'),dictionaryContext);
  const originalDictionary=JSON.parse(vm.runInContext('JSON.stringify(dict)',dictionaryContext));
  const currentDictionary=JSON.parse(run('JSON.stringify(dict)'));
  for(const [section,entries] of Object.entries(originalDictionary))
    for(const [key,value] of Object.entries(entries))
      assert.deepEqual(currentDictionary[section][key],value,`Existing preset ${section}.${key} must remain unchanged.`);
  // Compare the same ordinary sitting edit with no actions or expression.
  context.app.mode='edit';state.ops=['pose'];$('editPose').value='seated';
  const oldPrompt=before.prompt(),newPrompt=prompt();
  assert(newPrompt.length<oldPrompt.length*.7,'Expected at least 30% less repetition.');
  console.log(JSON.stringify({passed,beforeCharacters:oldPrompt.length,afterCharacters:newPrompt.length,
    reductionPercent:Math.round(100*(1-newPrompt.length/oldPrompt.length))}));
}else console.log(JSON.stringify({passed}));

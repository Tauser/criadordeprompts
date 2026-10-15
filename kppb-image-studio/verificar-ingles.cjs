const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const html=fs.readFileSync(__dirname+'/KPPB_Image_Studio_v5_1.html','utf8');
const catalog=fs.readFileSync(__dirname+'/textos-prompts.js','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
new vm.Script(catalog+'\n'+js);
for(const removed of ['outputPt','sendLanguage','customPt','wardrobePt','englishPending','bothView']) assert(!js.includes(removed),removed);
assert(html.includes('src="textos-prompts.js"'));
class Node {
  constructor(){this.value='';this.textContent='';this.checked=false;this.disabled=false;this.events={};this.classList={remove(){},add(){}};}
  addEventListener(event,callback){this.events[event]=callback;}
  replaceChildren(){}
  focus(){this.focused=true;}
}
const nodes=new Map();
const $=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
const state={generated:'Preset A in English.',sent:[],urls:[]};
const context=vm.createContext({
  $,console,crypto,Uint8Array,AbortSignal,setTimeout:()=>1,clearTimeout:()=>{},
  update:()=>{$('outputEn').value=state.generated},
  app:{mode:'generate',refs:[],packs:{}},val:id=>$(id).value,picked:()=>[],
  syncLinkedControls:()=>{},validateLinkedInputs:()=>null,poseProblems:()=>[],
  readWorkflowConfig:()=>({profile:'turbo',settings:{steps:8,cfg:1}}),syncWorkflowBusy:()=>{},
  sessionStorage:{setItem(){},getItem(){return null}},
  fetch:async(url,options)=>{
    state.urls.push(url);
    if(url==='/api/generate'){
      const body=JSON.parse(options.body);state.sent.push(body);
      return {ok:true,json:async()=>({prompt_id:'unit-test',seed:Number(body.seed)})};
    }
    if(url.startsWith('/api/job/'))return {ok:true,json:async()=>({status:'queued',seed:123})};
    return {ok:true,json:async()=>({jobs:[]})};
  },
});
const run=code=>vm.runInContext(code,context);
let passed=0;
function test(name,callback){callback();passed++;console.log('OK '+name)}
const start=js.indexOf('const manualPrompts ='),end=js.indexOf('function newRequestId()',start);
run(js.slice(start,end));
$('aspect').value='3:4';$('resolution').value='1024';$('generationSeed').value='123';run('update()');
test('Edição manual sobrevive a atualizações sem mudança de composição',()=>{
  $('outputEn').value='Manual English draft.';$('outputEn').events.input();run('update()');
  assert.equal($('outputEn').value,'Manual English draft.');
});
test('Novos parâmetros atualizam o único prompt e guardam o rascunho anterior',()=>{
  state.generated='Preset B with a new scene.';run('update()');
  assert.equal($('outputEn').value,state.generated);
  assert.equal(run('manualPromptBackup'),'Manual English draft.');
});
test('Recuperar edição manual devolve exatamente o rascunho salvo',()=>{
  $('restoreManualPrompts').events.click();assert.equal($('outputEn').value,'Manual English draft.');
});
test('Regerar pelos controles restaura o texto mesmo com parâmetros iguais',()=>{
  $('regeneratePrompts').events.click();assert.equal($('outputEn').value,state.generated);
  assert.equal(run('manualPrompts.en'),false);
});
run(js.match(/function promptReferences\(\) \{[\s\S]*?^      \}/m)[0]);
run(js.match(/function exportProject\(\) \{[\s\S]*?^      \}/m)[0]);
test('Projeto exportado contém apenas o prompt inglês',()=>{
  const project=run('exportProject()');
  assert.deepEqual(Object.keys(project.prompts),['en']);
  assert.equal(project.prompts.en,$('outputEn').value);
  assert(!('customPt' in project.settings));assert(!('wardrobePt' in project.settings));
});
const generationEnd=js.search(/for\s*\(const b of document\.querySelectorAll\("\[data-mode\]"\)\)/);
run(js.slice(end,generationEnd));run('comfyReady=true');
(async()=>{
  const prompt='Replace the jacket with a blue cotton shirt. Preserve the face.';
  $('outputEn').value=prompt;$('outputEn').events.input();
  await run('sendToComfy()');
  assert.equal(state.sent.length,1);assert.equal(state.sent[0].prompt,prompt);
  assert(!state.urls.some(url=>url.includes('translat')));
  passed++;console.log('OK envio usa exatamente o único campo EN, sem tradução ou escolha de idioma');
  run('generationBusy=false');state.sent=[];
  run("app.mode='edit';app.refs=[{name:'original.png',role:'target'}]");
  let resolveImage;context.imagePromise=new Promise(resolve=>resolveImage=resolve);
  run('encodedReference=()=>imagePromise');
  const request=run('sendToComfy()');
  $('resolution').value='2048';$('aspect').value='16:9';$('generationSeed').value='456';
  run("app.mode='generate';app.refs=[]");
  resolveImage({mime:'image/png',data:'unit-test-only'});await request;
  assert.equal(state.sent.length,1);const actual=state.sent[0];
  assert.equal(actual.mode,'edit');assert.equal(actual.resolution,1024);
  assert.equal(actual.aspect,'3:4');assert.equal(actual.seed,'123');assert.equal(actual.images.length,1);
  assert.equal(actual.prompt,prompt);
  passed++;console.log('OK envio mantém a configuração capturada antes da leitura da referência');
  state.participants=1;context.sceneRequiredParticipants=()=>state.participants;
  run("generationBusy=false;manualPrompts.en=false;app.mode='edit';app.refs=[{name:'target.png',file:{},role:'target'},{name:'partner.png',file:{},role:'second_participant'},{name:'outfit.png',file:{},role:'outfit'}];encodedReference=async ref=>({name:ref.name,role:ref.role,mime:'image/png',data:'unit-test-only'})");
  state.sent=[];await run('sendToComfy()');
  assert.deepEqual(state.sent[0].images.map(ref=>ref.name),['target.png','outfit.png']);
  let exported=run('exportProject()');
  assert.equal(exported.reference_images[1].slot,'image_2');assert.equal(exported.reference_images[1].role,'outfit');
  passed++;console.log('OK referência inativa de segundo personagem não é enviada nem exportada');
  state.participants=2;run('generationBusy=false');state.sent=[];await run('sendToComfy()');
  assert.deepEqual(state.sent[0].images.map(ref=>ref.name),['target.png','partner.png','outfit.png']);
  passed++;console.log('OK pedido de dupla reativa a referência na ordem correta do envio');
  state.participants=1;run('generationBusy=false');
  $('outputEn').value='Use <image2> as the outfit reference. Preserve the face.';$('outputEn').events.input();
  state.sent=[];await run('sendToComfy()');
  assert.deepEqual(state.sent[0].images.map(ref=>ref.name),['target.png','outfit.png']);
  assert.equal(state.sent[0].images[1].role,'outfit');assert.equal(state.sent[0].prompt,$('outputEn').value);
  passed++;console.log('OK editar prompt manualmente mantém a foto e o papel associados a image2');
  run("generationBusy=false;app.mode='edit';app.refs=[{name:'target.png',role:'target'}]");
  state.sent=[];$('editPose').value='walking';
  context.picked=()=>['pose'];context.poseProblems=()=>['exige corpo inteiro'];
  await run('sendToComfy()');assert.equal(state.sent.length,0);
  passed++;console.log('OK pose incompatível bloqueia o envio');
  context.picked=()=>[];context.poseProblems=()=>[];
  context.validateLinkedInputs=()=>({field:'customEn',message:'Preencha a instrução em inglês.'});
  run('manualPrompts.en=false');await run('sendToComfy()');
  assert.equal(state.sent.length,0);assert($('customEn').focused);
  passed++;console.log('OK descrição ausente aponta o campo inglês antes de enviar');
  console.log(JSON.stringify({passed,syntax:'valid'}));
})().catch(error=>{console.error(error);process.exitCode=1});

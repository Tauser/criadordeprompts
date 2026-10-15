// Character-reference lifecycle checks; no ComfyUI submissions or image generation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/KPPB_Image_Studio_v5_1.html','utf8');
const catalog=fs.readFileSync(__dirname+'/textos-prompts.js','utf8');
const js=html.split('<script>')[1].split('</script>')[0];
const nodes=new Map();
const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:false,removeAttribute(key){delete this[key]}});return nodes.get(id)};
Object.entries({editPose:'seated',editStrategy:'short',poseFraming:'preserve',poseSupport:'preserve',shot:'auto',
  subject:'woman',age:'adult',environment:'studio',wardrobe:'casual',pose:'neutral',action:'none',camera:'auto',light:'soft'})
  .forEach(([id,value])=>$(id).value=value);
const originalFile={name:'original-character.png',type:'image/png',size:10};
const original={name:originalFile.name,file:originalFile,url:'blob:original-target',role:'target'};
const state={ops:['pose'],keep:['face','body','skin','hair','clothes']};
const app={mode:'edit',style:'real',refs:[original],characterReference:null,packs:{poses:{},actions:{},group:{}}};
let serial=0,renderCount=0;
const revoked=new Set();
class LocalFile{constructor(parts,name,options){this.name=name;this.type=options.type;this.size=10}}
const context=vm.createContext({$,app,val:id=>$(id).value,activeOperations:()=>state.ops,
  getActualPreserve:()=>state.keep,getEditStrategy:()=>$('editStrategy').value,picked:id=>id==='editOps'?state.ops:state.keep,
  poseRule:()=>({full:true}),syncLinkedControls:()=>{},renderRefs:()=>{renderCount++},update:()=>{},toast:()=>{},
  generationStatus:message=>{throw new Error(message)},
  URL:{createObjectURL:()=>`blob:fixed-${++serial}`,revokeObjectURL:url=>revoked.add(url)},File:LocalFile,
  fetch:async()=>({ok:true,blob:async()=>({type:'image/png'})})});
const run=code=>vm.runInContext(code,context);
run(catalog);
run(js.slice(js.indexOf('function promptReferences()'),js.indexOf('function renderRefs()')));
run(js.match(/async function useResultAsTarget\(url, name\) \{[\s\S]*?^      \}/m)[0]);
context.addRefs=async files=>{for(const file of files)app.refs.push({name:file.name,file,url:`blob:target-${++serial}`,role:'target'})};
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name)}

(async()=>{
  test('Fixar original usa o mesmo arquivo sem duplicar a referência inicial',()=>{
    run('pinCharacterReference()');const refs=run('promptReferences()');
    assert.equal(app.characterReference.file,originalFile);assert.equal(refs.length,1);
    assert(refs[0].characterSource);assert.equal(refs[0].role,'target');
    const p=run("compose('en')");assert(p.includes('body proportions (torso, limbs, hands and feet) from <image1>'));
    assert(!p.includes('Preserve facial identity, body proportions')); // no contradictory duplicate source
  });
  const fixedUrl=app.characterReference.url;
  await run("useResultAsTarget('/api/image?job=test&index=0','result-1.png')");
  test('Resultado substitui somente o alvo e mantém a foto original como referência',()=>{
    const refs=run('promptReferences()');assert.equal(refs.length,2);
    assert.equal(refs[0].name,'result-1.png');assert.equal(refs[1].file,originalFile);
    assert.equal(refs[1].role,'character');assert(!revoked.has(fixedUrl));
    assert(revoked.has('blob:original-target'));assert(renderCount>0);
    assert(run("compose('en')").includes('from <image2> across pose and perspective changes'));
  });
  await run("useResultAsTarget('/api/image?job=test&index=1','result-2.png')");
  test('Edições sucessivas não promovem resultado gerado a personagem fixo',()=>{
    const refs=run('promptReferences()');assert.equal(refs[0].name,'result-2.png');
    assert.equal(app.characterReference.file,originalFile);assert.equal(refs[1].file,originalFile);
  });
  test('Trocar pose permite articulações novas mantendo proporções do original',()=>{
    const p=run("compose('en')");assert(p.includes('Use the exact requested pose'));
    assert(p.includes('no reshaping'));assert(!p.includes('keep the original body position'));
  });
  test('Troca explícita de cabelo não recebe bloqueio do cabelo da referência',()=>{
    state.ops=['pose','hair'];const p=run("compose('en')");
    assert(!p.includes('hairline and hairstyle'));assert(p.includes('Modify the hairstyle'));
    state.ops=['pose'];
  });
  test('Roupa, pose e cenário da referência fixa não são copiados para o alvo',()=>{
    const p=run("compose('en')");assert(p.includes('Preserve original outfit'));
    assert(!p.includes('reference for outfit design'));assert(!p.includes('reference for environment'));
  });
  test('Ordem de outras referências permanece estável e personagem fica no slot correto',()=>{
    app.refs.push({name:'outfit.png',file:{},role:'outfit'},{name:'pose.png',file:{},role:'pose'});
    const refs=run('promptReferences()');assert.deepEqual(Array.from(refs,r=>r.name),['result-2.png','outfit.png','pose.png',original.name]);
    const p=run("compose('en')");assert(p.includes('Use <image2> only as reference for outfit design'));
    assert(p.includes('Use <image3> only as reference for pose and body orientation'));
    assert(p.includes('from <image4> across pose and perspective changes'));
  });
  test('Fixar uma referência já anexada não ocupa outro slot nem muda o arquivo',()=>{
    const length=app.refs.length;run('pinCharacterReference(1)');
    assert.equal(run('promptReferences()').length,length);
    assert.equal(run('promptReferences()')[1].role,'character');assert.equal(app.refs[1].role,'outfit');
  });
  test('Desfixar libera apenas a prévia fixa e restaura referências normais',()=>{
    const file=app.refs[1].file,url=app.characterReference.url;run('clearCharacterReference()');
    assert.equal(app.characterReference,null);assert(revoked.has(url));
    assert.equal(run('promptReferences()')[1].role,'outfit');assert.equal(app.refs[1].file,file);
  });
  test('Geração sem imagem não usa nem promete a referência fixa',()=>{
    run('pinCharacterReference()');app.mode='generate';const p=run("compose('en')");
    assert(!p.includes('from <image'));assert(!p.includes('across pose and perspective changes'));
    const file=app.characterReference.file;run('pinCharacterReference(1)');assert.equal(app.characterReference.file,file);
    app.mode='edit';
  });
  test('Referência fixa adicional participa do limite de dez imagens',()=>{
    run('pinCharacterReference()');const other={name:'new-target.png',file:{},role:'target'};
    app.refs=[other,...Array.from({length:9},(_,i)=>({name:`ref-${i}`,file:{},role:'face'}))];
    run(js.match(/function validateLinkedInputs\(\) \{[\s\S]*?^      \}/m)[0]);
    assert.equal(run('promptReferences()').length,11);assert.equal(run('validateLinkedInputs()').field,'pinCharacter');
  });
  test('Referência guardada de segundo personagem não entra no prompt nem no envio sem ação ou pose de dupla',()=>{
    app.characterReference=null;
    app.refs=[{name:'target.png',file:{},role:'target'},
      {name:'partner.png',file:{},role:'second_participant'}];
    state.ops=[];
    const p=run("compose('en')");
    assert(!p.includes('second participant'));assert(!p.includes("both participants' identities"));
    assert.equal(run('promptReferences()').length,1);assert.equal(app.refs.length,2);
    $('editAction').value='basic:handshake';$('editPose').value='import:pair';
    app.packs.poses.pair={en:'two adults standing side by side',participants:2};
    assert.equal(run('sceneRequiredParticipants()'),1);
    assert.equal(run('promptReferences()').length,1);
  });
  test('Ação de dupla ativa referência própria sem atribuir sua aparência ao protagonista',()=>{
    state.ops=['action'];$('editAction').value='basic:handshake';
    const p=run("compose('en')");
    assert(p.includes('Use <image2> only as the visual reference for the second participant.'));
    assert(p.includes("Preserve the original protagonist's identity from <image1>."));
    assert(p.includes("Keep both participants' identities distinct; do not merge or swap their features."));
    assert(run("compose('pt')").includes('referência visual para o segundo personagem'));
  });
  test('Reordenar referências mantém a função e atualiza o slot no prompt',()=>{
    app.refs.splice(1,0,{name:'outfit.png',file:{},role:'outfit'});
    let p=run("compose('en')");
    assert(p.includes('Use <image2> only as reference for outfit design.'));
    assert(p.includes('Use <image3> only as the visual reference for the second participant.'));
    run(js.slice(js.indexOf('function moveRef('),js.indexOf('function promptReferences()')));
    run('moveRef(2,-1)');
    p=run("compose('en')");
    assert.equal(app.refs[1].role,'second_participant');
    assert(p.includes('Use <image2> only as the visual reference for the second participant.'));
    assert(p.includes('Use <image3> only as reference for outfit design.'));
  });
  test('Protagonista fixo mantém sua fonte mesmo com referência de outro personagem',()=>{
    run('pinCharacterReference(2)');
    const p=run("compose('en')");
    assert(p.includes('from <image3> across pose and perspective changes'));
    assert(p.includes('For the original protagonist, preserve facial identity'));
    assert(p.includes('Use <image2> only as the visual reference for the second participant.'));
    assert(!p.includes("Preserve the original protagonist's identity from <image1>."));
    run('clearCharacterReference()');
    app.refs[2].role='character';
    const manual=run("compose('en')");
    assert(manual.includes('Use <image3> only as the visual reference for the original protagonist.'));
    assert(!manual.includes("Preserve the original protagonist's identity from <image1>."));
  });
  test('Remover referência de segundo personagem remove também a instrução correspondente',()=>{
    app.refs.splice(1,1);
    const p=run("compose('en')");
    assert(!p.includes('second participant'));assert(!p.includes("both participants' identities"));
  });
  test('Pose de dupla ativa a referência e pose individual volta a desativá-la sem apagá-la',()=>{
    app.refs.splice(1,0,{name:'partner.png',file:{},role:'second_participant'});
    state.ops=['pose'];$('editPose').value='import:pair';
    assert(run("compose('en')").includes('visual reference for the second participant'));
    assert.equal(run('promptReferences()').length,3);
    $('editPose').value='neutral';
    assert(!run("compose('en')").includes('second participant'));
    assert.equal(run('promptReferences()').length,2);assert.equal(app.refs.length,3);
    assert(run("compose('en')").includes('Use <image2> only as the visual reference for the original protagonist'));
    app.packs.poses.pair={en:'standing with an adult partner'};$('editPose').value='import:pair';
    assert.equal(run('sceneRequiredParticipants()'),2);
  });
  test('Importação JSON conserva a quantidade declarada da pose sem depender de palavras-chave',()=>{
    run(js.match(/function importJSON\(txt\) \{[\s\S]*?^      \}/m)[0]);
    const data={poses:{pair:{en:'standing side by side',pt:'em pé lado a lado',participants:2}}};
    assert.equal(run(`importJSON(${JSON.stringify(JSON.stringify(data))})`),0);
    state.ops=['pose'];$('editPose').value='import:pair';
    assert.equal(app.packs.poses.pair.participants,2);
    assert(run("compose('en')").includes('visual reference for the second participant'));
  });
  test('Protagonista fixado não é descartado por ter sido marcado anteriormente como segundo personagem',()=>{
    state.ops=[];run('pinCharacterReference(1)');
    const refs=run('promptReferences()');
    assert.equal(refs.length,3);assert(refs[1].characterSource);assert.equal(refs[1].role,'character');
    run('clearCharacterReference()');assert.equal(run('promptReferences()').length,2);
  });
  test('Editar o texto manualmente não reativa foto inativa nem desloca os slots das demais',()=>{
    app.manualPrompts={en:true};
    const refs=run('promptReferences()');
    assert.equal(refs.length,2);assert.equal(refs[1].role,'character');
    app.manualPrompts.en=false;assert.equal(run('promptReferences()').length,2);
  });
  test('Referência de roupa fica guardada no estudo artístico e os slots restantes seguem corretos',()=>{
    app.characterReference=null;
    app.refs=[{name:'target.png',file:{},role:'target'},
      {name:'outfit.png',file:{},role:'outfit'},{name:'partner.png',file:{},role:'second_participant'}];
    state.ops=['action','removeall'];$('editAction').value='basic:handshake';$('fictionalConfirm').checked=true;
    const refs=run('promptReferences()');
    assert.equal(refs.length,2);assert.equal(refs[1].name,'partner.png');assert.equal(app.refs.length,3);
    let p=run("compose('en')");assert(!p.includes('reference for outfit design'));
    assert(p.includes('Use <image2> only as the visual reference for the second participant'));
    state.ops=['action'];
    p=run("compose('en')");assert.equal(run('promptReferences()').length,3);
    assert(p.includes('Use <image2> only as reference for outfit design'));
    assert(p.includes('Use <image3> only as the visual reference for the second participant'));
  });
  test('Referência corporal define anatomia visível sem exigir mudança de pose ou roupa',()=>{
    app.characterReference=null;
    app.refs=[{name:'target.png',file:{},role:'target'},{name:'body.png',file:{},role:'body'}];
    state.ops=[];state.keep=['face','body','skin','hair','pose','clothes'];$('fictionalConfirm').checked=false;
    const p=run("compose('en')");
    assert(p.includes('Primary body source for the original protagonist: <image2>.'));
    assert(p.includes('Preserve visible anatomy, silhouette, proportions'));
    assert(p.includes('Do not copy its facial identity, pose, clothing or setting; hidden details are unspecified'));
    assert(p.includes('original pose'));assert(p.includes('original outfit'));
    assert(!p.includes('otherwise keep the source image unchanged'));
    assert(!p.includes('Preserve facial identity, body proportions'));
    assert(!p.includes('skin tone and texture, hairstyle'));
    assert(run("compose('pt')").includes('Fonte corporal principal do protagonista original: <image2>.'));
  });
  test('Trocar pose ou executar ação mantém a mesma fonte e permite movimento natural',()=>{
    for(const ops of [['pose'],['action'],['pose','action']]){
      state.ops=ops;$('editPose').value='seated';$('editAction').value='basic:handshake';
      const p=run("compose('en')");
      assert(p.includes('Primary body source for the original protagonist: <image2>.'));
      assert(p.includes('across pose and action changes; no reshaping'));
      assert(p.includes('Allow natural joint movement and perspective'));
    }
  });
  test('Referência corporal tem prioridade sobre corpo da foto fixa sem substituir rosto',()=>{
    state.ops=[];run('pinCharacterReference(0)');
    let p=run("compose('en')");
    assert(p.includes('Preserve facial identity, hairline and hairstyle from <image1>'));
    assert(p.includes('Primary body source for the original protagonist: <image2>.'));
    assert(!p.includes('body proportions (torso, limbs, hands and feet) from <image1>'));
    app.refs.splice(1,1);p=run("compose('en')");
    assert(p.includes('body proportions (torso, limbs, hands and feet) from <image1>'));
    run('clearCharacterReference()');
  });
  test('Reordenar a referência corporal atualiza sua numeração sem trocar a foto',()=>{
    const body={name:'body.png',file:{},role:'body'};
    app.refs=[{name:'target.png',file:{},role:'target'},{name:'outfit.png',file:{},role:'outfit'},body];
    assert(run("compose('en')").includes('Primary body source for the original protagonist: <image3>.'));
    run('moveRef(2,-1)');
    assert.equal(app.refs[1].file,body.file);
    assert(run("compose('en')").includes('Primary body source for the original protagonist: <image2>.'));
  });
  test('Vistas adicionais não competem com a primeira fonte corporal nem com o rosto',()=>{
    app.refs=[{name:'target.png',file:{},role:'target'},{name:'body.png',file:{},role:'body'},
      {name:'body-side.png',file:{},role:'body'},{name:'face.png',file:{},role:'character'}];
    const p=run("compose('en')");
    assert.equal(p.split('Primary body source for the original protagonist').length-1,1);
    assert(p.includes('Use <image3> only as an additional view of the same protagonist'));
    assert(p.includes('<image2> remains the primary body source'));
    assert(p.includes("Use <image4> only as reference for the original protagonist's facial identity and hair"));
    assert(!p.includes('only as reference for body proportions'));
    state.ops=['hair'];
    assert(!run("compose('en')").includes("Use <image4> only as reference for the original protagonist's facial identity and hair"));
  });
  test('Fonte corporal do protagonista não é aplicada ao segundo personagem',()=>{
    state.ops=['action'];$('editAction').value='basic:conversation';
    app.refs=[{name:'target.png',file:{},role:'target'},{name:'body.png',file:{},role:'body'},
      {name:'partner.png',file:{},role:'second_participant'}];
    const p=run("compose('en')");
    assert(p.includes('Primary body source for the original protagonist: <image2>.'));
    assert(p.includes('Use <image3> only as the visual reference for the second participant'));
    assert(p.includes("Keep both participants' identities distinct"));
  });
  const retainedBody=app.refs[1];retainedBody.url='blob:retained-body';
  await run("useResultAsTarget('/api/image?job=test&index=2','result-3.png')");
  await run("useResultAsTarget('/api/image?job=test&index=3','result-4.png')");
  test('Reutilizar resultados mantém a referência corporal original em edições sucessivas',()=>{
    assert.equal(app.refs[0].name,'result-4.png');assert.equal(app.refs[1].file,retainedBody.file);
    assert.equal(app.refs.length,2);assert(!revoked.has(retainedBody.url));
    assert(run("compose('en')").includes('Primary body source for the original protagonist: <image2>.'));
  });
  app.characterReference={file:app.refs[0].file,name:app.refs[0].name,url:'blob:fixed-limit'};
  app.refs.push(...Array.from({length:8},(_,i)=>({name:`body-view-${i}.png`,file:{},role:'body',url:`blob:body-${i}`})));
  const beforeLimit=app.refs;let limitMessage='';context.generationStatus=message=>{limitMessage=message};
  await run("useResultAsTarget('/api/image?job=test&index=4','result-over-limit.png')");
  test('Limite de referências impede reutilização sem apagar fontes corporais ou o alvo',()=>{
    assert.equal(app.refs,beforeLimit);assert.equal(app.refs[0].name,'result-4.png');
    assert(limitMessage.includes('limite de dez imagens'));
  });
  console.log(JSON.stringify({passed,generatedImages:0}));
})().catch(error=>{console.error(error);process.exitCode=1});

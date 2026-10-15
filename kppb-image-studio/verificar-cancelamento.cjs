// Async cancellation races; never contacts ComfyUI or submits an image.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/KPPB_Image_Studio_v5_1.html', 'utf8');
const inline = html.split('<script>')[1].split('</script>')[0];
const workflows = fs.readFileSync(__dirname + '/studio-workflows.js', 'utf8');
new vm.Script(inline); new vm.Script(workflows);
const fn = (text, name, async = false) => text.match(new RegExp(`${async ? 'async ' : ''}function ${name}\\([^]*?^${text === inline ? '      ' : ''}\\}`, 'm'))[0];
const response = data => ({ok: true, json: async () => data});
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}};
let passed = 0;
function setup(fetch) {
  const nodes = new Map(), events = [];
  const $ = id => {if (!nodes.has(id)) nodes.set(id, {value: '', textContent: '', disabled: false}); return nodes.get(id)};
  const ctx = vm.createContext({$, val: id => $(id).value, generationBusy: true, generationStopping: false,
    currentJob: 'refiner', comfyReady: true, generationPollTimer: null, fetch, AbortSignal,
    clearTimeout() {}, setTimeout() {events.push('timer'); return 1},
    generationStatus: message => events.push(message), showGenerationProgress() {},
    showSubmittedRequest() {}, showRefinedPreview() {}, showGeneratedImages() {events.push('image')},
    refreshStudioJobs() {}, sessionStorage: {setItem() {}}});
  $('workflowProfile').value = 'qwen21';
  vm.runInContext(fn(workflows, 'syncWorkflowBusy'), ctx);
  vm.runInContext(fn(inline, 'stopGeneration', true), ctx);
  vm.runInContext(fn(inline, 'pollGeneration', true), ctx);
  return {ctx, $, events};
}
async function test(name, work) {await work(); passed++; console.log('OK ' + name)}
(async () => {
  await test('Parar envia somente o pedido acompanhado e libera nova geração após confirmação', async () => {
    const pending = deferred(), calls = [];
    const {ctx, $} = setup(async (url, options) => {calls.push({url, body: JSON.parse(options.body)}); return pending.promise});
    const stopping = ctx.stopGeneration();
    assert.equal($('stopGeneration').disabled, true); assert.equal($('stopGeneration').textContent, 'Parando…');
    assert.equal($('resumeGeneration').disabled, true);
    pending.resolve(response({status: 'cancelled'})); await stopping;
    assert.deepEqual(calls, [{url: '/api/cancel', body: {prompt_id: 'refiner'}}]);
    assert.equal(ctx.generationBusy, false); assert.equal($('sendToComfy').disabled, false);
    assert.equal($('stopGeneration').disabled, true); assert.equal($('resumeGeneration').disabled, false);
  });
  await test('Sem identificador de envio o botão permanece desativado e não envia cancelamento', async () => {
    const {ctx, $} = setup(() => {throw new Error('unexpected fetch')});
    ctx.currentJob = ''; ctx.syncWorkflowBusy(); await ctx.stopGeneration();
    assert.equal($('stopGeneration').disabled, true);
  });
  await test('Falha de conexão permite repetir Parar sem declarar geração interrompida', async () => {
    const {ctx, $, events} = setup(async () => {throw new Error('offline')});
    await ctx.stopGeneration();
    assert.equal(ctx.generationBusy, true); assert.equal(ctx.generationStopping, false);
    assert.equal($('stopGeneration').disabled, false); assert(events.at(-1).includes('Não foi possível confirmar'));
  });
  await test('Resposta atrasada do aprimoramento não inicia imagem após cancelamento', async () => {
    const get = deferred(), calls = [];
    const {ctx} = setup(async url => {calls.push(url); return url.startsWith('/api/job/') ? get.promise : response({status: 'cancelled'})});
    const polling = ctx.pollGeneration(); await ctx.stopGeneration();
    get.resolve(response({status: 'completed', kind: 'refine', intent: 'generate', refined_prompt: 'Make the circle red.'}));
    await polling; assert(!calls.includes('/api/continue'));
  });
  await test('Cancelamento durante continuação ignora resposta atrasada do segundo estágio', async () => {
    const next = deferred(), entered = deferred();
    const {ctx, events} = setup(async url => {
      if (url.startsWith('/api/job/')) return response({status: 'completed', kind: 'refine', intent: 'generate', refined_prompt: 'Make the circle red.'});
      if (url === '/api/continue') {entered.resolve(); return next.promise}
      return response({status: 'cancelled'});
    });
    const polling = ctx.pollGeneration(); await entered.promise; await ctx.stopGeneration();
    next.resolve(response({prompt_id: 'image'})); await polling;
    assert.equal(ctx.currentJob, 'refiner'); assert.equal(ctx.generationBusy, false); assert(!events.includes('timer'));
  });
  await test('Retomar pedido já cancelado encerra o acompanhamento sem exibir resultado', async () => {
    const {ctx, $, events} = setup(async () => response({status: 'cancelled'}));
    await ctx.pollGeneration(); assert.equal(ctx.generationBusy, false);
    assert.equal($('stopGeneration').disabled, true); assert(!events.includes('image')); assert(!events.includes('timer'));
  });
  await test('Cancelamento pendente conserva o botão para nova tentativa', async () => {
    const {ctx, events} = setup(async () => response({status: 'cancelling'}));
    await ctx.pollGeneration(); assert.equal(ctx.generationBusy, true);
    assert(events.at(-1).includes('Cancelamento pendente')); assert(!events.includes('timer'));
  });
  console.log(JSON.stringify({passed, generatedImages: 0}));
})().catch(error => {console.error(error); process.exitCode = 1});

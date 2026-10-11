
const offline = new URLSearchParams(location.search).has('offline');
const roots = [
  { id:'ws',name:'Workspace',className:'Workspace',parentId:'game',isScript:false },
  { id:'sss',name:'ServerScriptService',className:'ServerScriptService',parentId:'game',isScript:false },
  { id:'players',name:'Players',className:'Players',parentId:'game',isScript:false },
  { id:'folder',name:'Gameplay',className:'Folder',parentId:'ws',isScript:false },
  { id:'s1',name:'Main',className:'Script',parentId:'ws',isScript:true,source:'print("hello")',revision:1 },
  { id:'s2',name:'Main',className:'Script',parentId:'ws',isScript:true,source:'print("two")',revision:1 },
  { id:'s3',name:'Other',className:'LocalScript',parentId:'ws',isScript:true,source:'print("third")',revision:1 },
];
window.__mockNodes = roots;
const online = {connected:true, ready:true,placeKey:'100-200',placeName:'Sample Place',nodeCount:roots.length, pairingCode:null};
const noSession = {connected:false,ready:false,placeKey:'offline',placeName:'Recovered Place',pairingCode:'432987'};
window.__mutations = [];
window.cursorBridge = {
  saveQuickApplyDraft: async (text) => { window.__savedQuickApplyInput = text; return {ok:true}; },
  getQuickApplyDraft: async () => '',
  onEvent(fn){window.__emitServer = fn;},
  async getState(){return {status: offline ? noSession : online, nodes:roots};},
  async getAppVersion(){return '0.3.0';},
  async getDraft(){return null;},
  async saveDraft(){}, async clearDraft(){}, async writeScript(){return {status:'queued'};},
  async mutateHierarchy(command){const opId=`mut-${window.__mutations.length+1}`; window.__mutations.push({...command,opId});return {status:'queued',opId,count:1};},
  async requestChildren(){return {status:'complete',offset:0,total:0,complete:true};},
  async getBackups(){return [];},
  async copyText(){}, async disconnect(){window.__emitServer({type:'status',status:noSession});},
  async openStudioScript(){}, async openBackupsFolder(){}, async checkForUpdates(){return {reason:'No updates'};},
};

import type {EffectDefinition} from './effects';
export class NeuralProcessor{
  private worker:Worker|null=null;
  private ready=false;
  private busy=false;
  private last=0;
  private id=0;
  private watchdog:ReturnType<typeof setTimeout>|null=null;
  constructor(private deliver:(original:ImageBitmap,styled:ImageBitmap,elapsed:number)=>void,private failed:(message:string)=>void){}
  start(spec:NonNullable<EffectDefinition['model']>):void{
    this.stop();
    const worker=new Worker(new URL('./style.worker.ts',import.meta.url),{type:'module'});this.worker=worker;
    this.watchdog=setTimeout(()=>this.failed('AI anime took too long to load. Try again or use Cartoon.'),45_000);
    worker.onmessage=(event:MessageEvent)=>{
      const message=event.data;
      if(worker!==this.worker){message.image?.close();message.styled?.close();return;}
      if(message.type==='READY'){this.ready=true;if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;}
      if(message.type==='RESULT'){this.busy=false;if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;this.deliver(message.image,message.styled,message.elapsed);}
      if(message.type==='ERROR')this.failed(message.message);
    };
    worker.onerror=()=>this.failed('AI anime could not start. Try Cartoon or a recent browser.');
    worker.postMessage({type:'INIT',spec,origin:new URL(import.meta.env.BASE_URL,location.origin).href,wasmRoot:new URL(`${import.meta.env.BASE_URL}models/style-wasm/`,location.origin).href});
  }
  async request(video:HTMLVideoElement,timestamp:number):Promise<void>{
    if(!this.ready||this.busy||!this.worker||timestamp-this.last<125)return;
    const worker=this.worker;this.busy=true;this.last=timestamp;
    try{const image=await createImageBitmap(video);if(worker!==this.worker){image.close();return;}this.watchdog=setTimeout(()=>this.failed('AI anime is too slow on this device. The fast Cartoon effect is available.'),15_000);worker.postMessage({type:'FRAME',id:++this.id,image},[image]);}
    catch{this.busy=false;if(worker===this.worker)this.failed('AI anime could not read this camera. Try the fast Cartoon effect.');}
  }
  stop():void{if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;this.worker?.terminate();this.worker=null;this.ready=false;this.busy=false;}
}

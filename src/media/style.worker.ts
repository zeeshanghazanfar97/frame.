/// <reference lib="webworker" />
import * as tf from '@tensorflow/tfjs';
import {setWasmPaths,setThreadsCount} from '@tensorflow/tfjs-backend-wasm';
import type {EffectDefinition} from './effects';
let model:tf.GraphModel|null=null;
let spec:NonNullable<EffectDefinition['model']>;
let side=160;
const inputCanvas=new OffscreenCanvas(1,1),outputCanvas=new OffscreenCanvas(1,1);
self.onmessage=async(event:MessageEvent)=>{
  const message=event.data;
  if(message.type==='INIT'){
    spec=message.spec;side=spec.size;
    try{
      setThreadsCount(1);setWasmPaths(message.wasmRoot);
      let backend='webgl';
      try{if(!await tf.setBackend('webgl'))throw new Error('No worker GPU');await tf.ready();}
      catch{backend='wasm';if(!await tf.setBackend('wasm'))throw new Error('No WASM backend');await tf.ready();}
      model=await tf.loadGraphModel(new URL(spec.url,message.origin).href);
      self.postMessage({type:'READY',backend});
    }catch(error){console.error('Style model initialization failed:',error);self.postMessage({type:'ERROR',message:'AI anime could not load. Try again or use the fast Cartoon effect.'});}
  }else if(message.type==='FRAME'){
    let tensor:tf.Tensor|null=null,output:tf.Tensor|null=null;
    const original:ImageBitmap=message.image;
    try{
      if(!model)throw new Error('Model not ready');
      const started=performance.now(),ratio=side/Math.max(original.width,original.height);
      const width=Math.max(32,Math.round(original.width*ratio/8)*8),height=Math.max(32,Math.round(original.height*ratio/8)*8);
      inputCanvas.width=width;inputCanvas.height=height;
      const context=inputCanvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(original,0,0,width,height);
      const rgba=context.getImageData(0,0,width,height).data;
      const values=new Float32Array(width*height*3);
      for(let i=0;i<width*height;i++){values[i*3]=rgba[i*4+(spec.colorOrder==='bgr'?2:0)];values[i*3+1]=rgba[i*4+1];values[i*3+2]=rgba[i*4+(spec.colorOrder==='bgr'?0:2)];}
      tensor=tf.tensor3d(values,[height,width,3]);output=model.execute({[spec.input]:tensor},spec.output) as tf.Tensor;
      const data=await output.data(),pixels=new Uint8ClampedArray(width*height*4);
      for(let i=0;i<width*height;i++){pixels[i*4]=Number(data[i*3+(spec.colorOrder==='bgr'?2:0)]);pixels[i*4+1]=Number(data[i*3+1]);pixels[i*4+2]=Number(data[i*3+(spec.colorOrder==='bgr'?0:2)]);pixels[i*4+3]=255;}
      outputCanvas.width=width;outputCanvas.height=height;outputCanvas.getContext('2d')!.putImageData(new ImageData(pixels,width,height),0,0);
      const styled=outputCanvas.transferToImageBitmap(),elapsed=performance.now()-started;
      if(elapsed>180&&side>96)side=96;
      self.postMessage({type:'RESULT',id:message.id,image:original,styled,elapsed},[original,styled]);
    }catch(error){original.close();console.error('Style inference failed:',error);self.postMessage({type:'ERROR',message:'AI anime is unavailable on this device. The fast Cartoon effect is ready to use.'});}
    finally{tensor?.dispose();output?.dispose();}
  }
};

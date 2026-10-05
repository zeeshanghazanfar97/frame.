import { getEffect } from './effects';
import { fitSize } from './geometry';
import type { ApplyMode, PortalState } from './types';
import type { VideoRenderer } from './rendering';

export class CanvasRenderer implements VideoRenderer {
  readonly backend='canvas' as const;
  readonly canvas=document.createElement('canvas');
  private raw=document.createElement('canvas');
  private processed=document.createElement('canvas');
  private pixel=document.createElement('canvas');
  private video!:HTMLVideoElement;
  private mirror=false;
  private effect='pixelate';
  private neuralReady=false;
  async init(video:HTMLVideoElement,host:HTMLElement,longEdge:number,mirror:boolean):Promise<void>{
    this.video=video;this.mirror=mirror;this.resize(Math.min(640,longEdge),video.videoWidth,video.videoHeight);
    this.canvas.setAttribute('data-testid','camera-canvas');this.canvas.setAttribute('aria-label','Live camera with selected effect');
    host.replaceChildren(this.canvas);
  }
  setEffect(id:string):void{this.clearNeuralFrame();this.effect=id;}
  setNeuralFrame(original:ImageBitmap,styled:ImageBitmap):void{
    this.raw.getContext('2d')!.drawImage(original,0,0,this.raw.width,this.raw.height);
    this.processed.getContext('2d')!.drawImage(styled,0,0,this.processed.width,this.processed.height);
    this.neuralReady=true;
  }
  clearNeuralFrame():void{this.neuralReady=false;}
  resize(longEdge:number,width:number,height:number):void{
    const size=fitSize(width,height,Math.min(640,longEdge));
    for(const canvas of [this.canvas,this.raw,this.processed]){canvas.width=size.width;canvas.height=size.height;}
  }
  render(portal:PortalState,strength:number,_seconds:number,_newFrame:boolean,mode:ApplyMode='window'):void{
    const width=this.canvas.width,height=this.canvas.height;
    const raw=this.raw.getContext('2d',{willReadFrequently:true})!;
    const neural=getEffect(this.effect).canvas==='model';
    if(strength===0||(mode==='window'&&portal.visibility===0))this.neuralReady=false;
    if(!neural||!this.neuralReady)raw.drawImage(this.video,0,0,width,height);
    const output=this.canvas.getContext('2d')!;output.save();output.clearRect(0,0,width,height);
    if(this.mirror){output.translate(width,0);output.scale(-1,1);}
    output.drawImage(this.raw,0,0);
    const amount=strength*(mode==='full'?1:portal.visibility);
    const preset=getEffect(this.effect).canvas;
    if(amount>0 && preset && (!neural||this.neuralReady)){
      const filtered=this.processed.getContext('2d',{willReadFrequently:true})!;
      if(preset==='model'){
        // The worker already supplied matching original and stylized images.
      }else if(preset==='pixelate'){
        this.pixel.width=Math.max(1,Math.ceil(width/12));this.pixel.height=Math.max(1,Math.ceil(height/12));
        this.pixel.getContext('2d')!.drawImage(this.raw,0,0,this.pixel.width,this.pixel.height);
        filtered.imageSmoothingEnabled=false;filtered.drawImage(this.pixel,0,0,width,height);filtered.imageSmoothingEnabled=true;
      }else{
        const image=raw.getImageData(0,0,width,height),original=new Uint8ClampedArray(image.data),data=image.data;
        for(let i=0;i<data.length;i+=4){
          const r=original[i],g=original[i+1],b=original[i+2];
          if(preset==='grayscale'){const gray=.299*r+.587*g+.114*b;data[i]=data[i+1]=data[i+2]=gray;}
          else if(preset==='sepia'){data[i]=.393*r+.769*g+.189*b;data[i+1]=.349*r+.686*g+.168*b;data[i+2]=.272*r+.534*g+.131*b;}
          else if(preset==='negative'){data[i]=255-r;data[i+1]=255-g;data[i+2]=255-b;}
          else if(preset==='warm'){data[i]=r*1.12+9;data[i+1]=g*1.02+3;data[i+2]=b*.85;}
          else if(preset==='cool'){data[i]=r*.85;data[i+1]=g*1.03+3;data[i+2]=b*1.16+6;}
          else if(preset==='cartoon'||preset==='anime'){
            const step=255/(preset==='anime'?9:6);
            for(let channel=0;channel<3;channel++)data[i+channel]=Math.round(original[i+channel]/step)*step;
            const x=(i/4)%width,y=Math.floor(i/4/width);
            if(x>0&&x<width-1&&y>0&&y<height-1){
              const lum=(offset:number)=>.299*original[offset]+.587*original[offset+1]+.114*original[offset+2];
              const edge=Math.hypot(lum(i+4)-lum(i-4),lum(i+width*4)-lum(i-width*4));
              if(edge>42){data[i]=14;data[i+1]=17;data[i+2]=23;}
            }
          }
        }
        filtered.putImageData(image,0,0);
      }
      if(mode==='window'&&portal.corners){output.beginPath();portal.corners.forEach((p,i)=>i?output.lineTo(p.x*width,p.y*height):output.moveTo(p.x*width,p.y*height));output.closePath();output.clip();}
      output.globalAlpha=amount;output.drawImage(this.processed,0,0);
    }
    output.restore();
  }
  photo():Promise<Blob>{return new Promise((resolve,reject)=>this.canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not save this photo.')),'image/png'));}
  destroy():void{this.canvas.remove();for(const canvas of [this.canvas,this.raw,this.processed,this.pixel]){canvas.width=0;canvas.height=0;}}
}

import protobuf from 'protobufjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=process.argv[2];
if(!source)throw new Error('Pass the downloaded DCT-Net cartoon_h.pb file.');
const bytes=await readFile(source);
const expected='338e7bf7ab4014ba9da864c2dda104f26d8af6c7f468038782d92ccc8e2dedda';
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('DCT-Net source checksum mismatch.');
const root=await protobuf.load('scripts/tensorflow-graph.proto'),type=root.lookupType('GraphDef');
const graph=type.toObject(type.decode(bytes),{enums:String,longs:Number,bytes:String});
graph.versions??={producer:0,minConsumer:0};
const specs=[],chunks=[];
for(const node of graph.node){
  if(node.op!=='Const')continue;
  const tensor=node.attr.value.tensor,shape=(tensor.tensorShape?.dim??[]).map(dim=>dim.size??0),count=shape.reduce((a,b)=>a*b,1);
  let dtype,chunk;
  if(tensor.dtype==='DT_FLOAT')dtype='float32';
  else if(tensor.dtype==='DT_INT32'||tensor.dtype==='DT_INT64')dtype='int32';
  else if(tensor.dtype==='DT_BOOL')dtype='bool';
  else throw new Error(`Unsupported weight dtype: ${tensor.dtype}`);
  if(tensor.tensorContent && tensor.dtype!=='DT_INT64')chunk=Buffer.from(tensor.tensorContent,'base64');
  else {
    const values=tensor.floatVal??tensor.intVal??tensor.int64Val??tensor.boolVal??[];
    const raw=tensor.tensorContent?Buffer.from(tensor.tensorContent,'base64'):null;
    chunk=Buffer.alloc(count*(dtype==='bool'?1:4));
    for(let i=0;i<count;i++){
      const value=raw?Number(raw.readBigInt64LE(i*8)):Number(values[Math.min(i,values.length-1)]??0);
      if(dtype==='float32')chunk.writeFloatLE(value,i*4);else if(dtype==='int32')chunk.writeInt32LE(value,i*4);else chunk[i]=value?1:0;
    }
  }
  specs.push({name:node.name,shape,dtype});chunks.push(chunk);
  delete tensor.tensorContent;delete tensor.floatVal;delete tensor.intVal;delete tensor.int64Val;delete tensor.boolVal;
}
const inputs=graph.node.filter(node=>node.op==='Placeholder');
const consumed=new Set(graph.node.flatMap(node=>node.input??[]).map(name=>name.replace(/^\^/,'').split(':')[0]));
const outputs=graph.node.filter(node=>!consumed.has(node.name)&&node.op!=='Const'&&node.op!=='NoOp');
const destination='public/models/dct-anime';await mkdir(destination,{recursive:true});
await writeFile(`${destination}/weights.bin`,Buffer.concat(chunks));
await writeFile(`${destination}/model.json`,JSON.stringify({format:'graph-model',generatedBy:'TensorFlow frozen GraphDef',convertedBy:'Frame GraphDef adapter',modelTopology:graph,weightsManifest:[{paths:['weights.bin'],weights:specs}]}));
console.log(JSON.stringify({inputs:inputs.map(n=>({name:n.name,attrs:n.attr})),outputs:outputs.map(n=>({name:n.name,op:n.op})),ops:[...new Set(graph.node.map(n=>n.op))],weightsBytes:Buffer.concat(chunks).length}));

"""Local YOLO model validation and inference; stdin/stdout JSON lines."""
import argparse,json,os,sys,traceback
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('MKL_NUM_THREADS','2')
def event(**values):
    print('RVM_JSON '+json.dumps(values,allow_nan=False),flush=True)
def load_model(project):
    import torch
    torch.set_num_threads(2)
    from ultralytics import YOLO
    model=YOLO(str(Path(project)/'model.pt'))
    if model.task not in ('detect','segment','classify'):
        raise ValueError('Gunakan model YOLO deteksi, segmentasi, atau klasifikasi .pt.')
    return model
def inspect(args):
    import numpy as np
    model=load_model(args.project)
    names=model.names
    if isinstance(names,list):names=dict(enumerate(names))
    if not names or set(names)!=set(range(len(names))) or not all(isinstance(v,str) and v.strip() for v in names.values()):
        raise ValueError('Model tidak memiliki daftar kelas yang valid.')
    model.predict(np.zeros((320,320,3),dtype=np.uint8),imgsz=320,conf=.25,device='cpu',verbose=False)
    event(kind='model',task=model.task,classes=[names[i] for i in range(len(names))])
def result_boxes(result):
    boxes=[]
    if result.probs is not None:
        cls=int(result.probs.top1)
        boxes.append({'classId':cls,'label':result.names[cls],'confidence':float(result.probs.top1conf),'x':0,'y':0,'w':1,'h':1})
    elif result.boxes is not None:
        for box in result.boxes:
            xy=box.xyxyn[0].tolist();cls=int(box.cls[0]);boxes.append({'classId':cls,'label':result.names[cls],'confidence':float(box.conf[0]),'x':xy[0],'y':xy[1],'w':xy[2]-xy[0],'h':xy[3]-xy[1]})
    return boxes
def predict(args):
    from ultralytics import YOLO
    model=load_model(args.project)
    models={str(Path(args.project)/'model.pt'):model}
    event(kind='ready')
    for line in sys.stdin:
        try:
            request=json.loads(line)
            result=model.predict(request['path'],imgsz=320,conf=.25,device='cpu',verbose=False)[0]
            boxes=result_boxes(result)
            extra={}
            if request.get('pipeline'):
                from PIL import Image
                cfg=request['pipeline'];threshold=cfg['confidence']
                keep={str(Path(args.project)/'model.pt'),*[cfg[role]['path'] for role in ['object','pet','cap']]}
                for path in list(models):
                    if path not in keep:del models[path]
                for role in ['object','pet','cap']:
                    path=cfg[role]['path']
                    if path not in models:models[path]=YOLO(path)
                candidates=[b for b in boxes if b['classId']==cfg['object']['classId'] and b['confidence']>=threshold]
                accepted=False;pet=False;cap=False;cropBox=None
                # One bottle per inspection; ambiguous multiple objects are rejected.
                if len(candidates)==1:
                    b=candidates[0];photo=Image.open(request['path']).convert('RGB');w,h=photo.size
                    cropBox=b;crop=photo.crop((max(0,int(b['x']*w)),max(0,int(b['y']*h)),min(w,int((b['x']+b['w'])*w+1)),min(h,int((b['y']+b['h'])*h+1))))
                    answers={}
                    for role in ['pet','cap']:
                        r=models[cfg[role]['path']].predict(crop,imgsz=320,conf=threshold,device='cpu',verbose=False)[0]
                        predictions=result_boxes(r)
                        answers[role]=bool(predictions) and all(v['classId']==cfg[role]['classId'] and v['confidence']>=threshold for v in predictions)
                    pet=answers['pet'];cap=answers['cap'];accepted=pet and cap
                extra={'accepted':accepted,'pet':pet,'withoutCap':cap,'cropBox':cropBox,'objectCount':len(candidates)}
            event(kind='prediction',id=request['id'],boxes=boxes,**extra)
        except Exception as e:event(kind='error',id=request.get('id') if 'request' in locals() else None,message=str(e))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','predict','check']);parser.add_argument('--project');args=parser.parse_args()
    if args.action=='check':
        import ultralytics,torch
        event(kind='ready',version=ultralytics.__version__,torch=torch.__version__);return
    (inspect if args.action=='inspect' else predict)(args)
if __name__=='__main__':
    try:main()
    except Exception as error:event(kind='error',message=str(error));traceback.print_exc(file=sys.stderr);sys.exit(1)

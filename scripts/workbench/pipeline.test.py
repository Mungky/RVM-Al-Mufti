import contextlib,io,json,sys,tempfile,types,unittest,importlib.util
from pathlib import Path
from PIL import Image
spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('vision-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Vector:
    def __init__(self,v):self.v=v
    def tolist(self):return self.v
class Box:
    def __init__(self,cls,confidence=.9):self.cls=[cls];self.conf=[confidence];self.xyxyn=[Vector([.1,.2,.9,.8])]
class PipelineTest(unittest.TestCase):
    def test_pipeline_requires_positive_pet_and_without_cap_and_crops_original(self):
        cases=[([Box(0)],[Box(0)],[Box(0)],True),([Box(0)],[Box(0)],[Box(1)],False),([Box(0)],[Box(0)],[],False),([Box(0)],[Box(1)],[Box(0)],False),([Box(0),Box(0)],[Box(0)],[Box(0)],False),([Box(0,.3)],[Box(0)],[Box(0)],False),([Box(0)],[Box(0)],[Box(0),Box(1)],False)]
        for objects,pet,caps,expected in cases:
            calls=[];loads=[]
            class YOLO:
                def __init__(self,path):self.path=path;self.task="detect";loads.append(path)
                def predict(self,photo,**kw):
                    calls.append((self.path,photo,kw));rows=objects if self.path.endswith('/model.pt') else pet if self.path=='pet' else caps
                    return [types.SimpleNamespace(probs=None,boxes=[b for b in rows if b.conf[0]>=kw['conf']],names={0:'match',1:'reject'})]
            sys.modules['torch']=types.SimpleNamespace(set_num_threads=lambda n:None);sys.modules['ultralytics']=types.SimpleNamespace(YOLO=YOLO)
            with tempfile.TemporaryDirectory() as folder:
                photo=Path(folder)/'frame.jpg';Image.new('RGB',(1000,800)).save(photo)
                cfg={'object':{'path':folder+'/model.pt','classId':0},'pet':{'path':'pet','classId':0},'cap':{'path':'cap','classId':0},'confidence':.6,'requireNoCap':True}
                request={'id':'one','path':str(photo),'pipeline':cfg};stdin=sys.stdin;sys.stdin=io.StringIO(json.dumps(request)+'\n'+json.dumps({**request,'id':'two'})+'\n');output=io.StringIO()
                try:
                    with contextlib.redirect_stdout(output):worker.predict(types.SimpleNamespace(project=folder))
                finally:sys.stdin=stdin
                events=[json.loads(line.removeprefix('RVM_JSON ')) for line in output.getvalue().splitlines()];self.assertEqual(events[1]['accepted'],expected);self.assertEqual(events[2]['accepted'],expected);self.assertEqual(len(loads),3)
                crops=[v for p,v,k in calls if p=='pet']
                if crops:self.assertEqual(crops[0].size,(801,481))
    def test_classification_result_maps_top_class_and_probability(self):
        result=types.SimpleNamespace(probs=types.SimpleNamespace(top1=1,top1conf=.87),names={0:'with cap',1:'without cap'})
        rows=worker.result_boxes(result)
        self.assertEqual(rows[0]['classId'],1)
        self.assertEqual(rows[0]['confidence'],.87)
        self.assertEqual(rows[0]['w'],1)
        self.assertEqual(worker.result_boxes(types.SimpleNamespace(probs=None,boxes=[])),[])
if __name__=='__main__':unittest.main()

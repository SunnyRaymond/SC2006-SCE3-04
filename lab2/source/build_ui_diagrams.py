"""Native UML use case and UI state diagrams for the Lab2 analysis."""
from build_entities import View, OUT
import json

def arrow(v,id,pts):
    v.edge(id,pts)
    cell=v.root.find("mxCell[@id='"+id+"']")
    cell.set('style',cell.get('style')+'endArrow=block;endFill=1;endSize=10;')

def state(v,id,title,body,x,y,w=310,h=150):
    v.box(id,title+'\n\n'+body,x,y,w,h,'rounded=1;arcSize=15;whiteSpace=wrap;align=center;verticalAlign=middle;fontFamily=Arial;fontSize=18;spacing=12;fillColor=#F0F5FA;strokeColor=#475569;strokeWidth=1.6;')

def usecases():
    v=View('Complete Use Case Model')
    v.box('system','PlugPlan SG',350,15,550,700,'swimlane;startSize=35;fillColor=#FFFFFF;swimlaneFillColor=#FFFFFF;fontSize=21;fontStyle=1;strokeColor=#475569;')
    names=['Access Account','Manage EV Profile','Create Charging Plan','Review and Compare Recommendations','Reconfigure Charging Plan','Refresh Plan and Select Fallback','Submit Charger Issue','Moderate Charger Reports']
    ys=[]
    for i,name in enumerate(names):
        y=65+i*78; ys.append(y+29)
        v.box('uc'+str(i+1),f'UC-0{i+1}  {name}',385,y,480,58,'ellipse;whiteSpace=wrap;fontSize=18;spacing=8;fillColor=#EEF4F8;strokeColor=#475569;strokeWidth=1.5;')
    actor='shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;fontSize=19;whiteSpace=wrap;'
    v.box('driver','Driver',70,270,90,120,actor)
    v.box('providers','',1120,160,100,120,actor)
    v.txt('External Data Providers',1020,285,285,55)
    v.box('moderator','Moderator',1120,550,100,120,actor)
    for i in range(7): v.edge('driver'+str(i),[(160,330),(385,ys[i])])
    for i in [2,4,5]: v.edge('provider'+str(i),[(1120,220),(865,ys[i])])
    v.edge('mod1',[(1120,610),(980,610),(980,ys[0]),(865,ys[0])])
    v.edge('mod8',[(1120,610),(1000,610),(1000,ys[7]),(865,ys[7])])
    v.txt('Supporting roles are grouped for readability.\nOneMap: places and routes.\nLTA DataMall: station snapshots.',1020,375,285,145)
    v.txt('Solid lines represent participation. Authentication is a precondition; no include or extend relationship is asserted.',20,745,1280,42)
    return v

def collaborations():
    v=View('Key boundary and control collaborations')
    rows=[('AccountAccessView','emailInput; inputError','AccountAccessControl','session?; role?','User',40),('PlanInputView','pendingInputs; routeError','ChargingPlanControl','currentPlan?; pendingRecalculation','ChargingPlan; PlanVersion',280),('ModeratorReviewView','activeReport; decisionReason','ModerationControl','decisionDraft; concurrencyToken?','IssueReport; ModerationDecision',520)]
    for i,(b,ba,c,ca,entities,y) in enumerate(rows):
        v.cls('b'+str(i),b,[ba],30,y,370,135); v.cls('c'+str(i),c,[ca],500,y,390,135)
        for ident,stereotype in [('b'+str(i),'boundary'),('c'+str(i),'control')]:
            node=v.root.find("mxCell[@id='"+ident+"head']"); node.set('value',node.get('value').replace('«entity»','«'+stereotype+'»'))
        v.txt(entities,990,y+20,300,95)
        arrow(v,'bc'+str(i),[(400,y+67),(500,y+67)]); arrow(v,'ce'+str(i),[(890,y+67),(980,y+67)])
    v.txt('ChargingPlanControl coordinates ExternalDataControl, FeasibilityControl, StationRankingControl and ModeratorFaultFilter. The sequence is calculate/rank → fault filter → shortlist/version.',360,435,940,70)
    v.txt('Representative collaborations. The full catalogue specifies all nine boundary classes and nine control classes, including profile, comparison, reporting and provider boundaries.',30,700,1260,65)
    return v

def driver_dialog():
    v=View('Driver UI Dialog Map')
    state(v,'access','D-00 Account Access','Sign-in / registration / errors',30,65,300,135)
    state(v,'profile','D-01 Vehicle Profile','Empty / edit / saved / validation',510,65,340,135)
    state(v,'input','D-02 Plan Input  =  M-01','Journey inputs / manual target\nAmbiguity or route error retains inputs',510,355,340,160)
    state(v,'results','D-03 Recommendations  =  M-02','Shortlist / one option / no options\nEnough charge / fallback / data state',30,355,340,185)
    state(v,'compare','D-04 Compare and Reconfigure','Comparison / pending edits / reset\nProvider failure keeps prior version',980,355,320,185)
    v.box('initial','',140,5,20,20,'ellipse;fillColor=#111111;strokeColor=#111111;'); arrow(v,'start',[(150,25),(150,65)])
    arrow(v,'login',[(330,132),(510,132)]); v.txt('valid Driver login',336,85,170,34)
    arrow(v,'validprofile',[(680,200),(680,355)]); v.txt('Plan a Charge\n[valid profile]',690,285,195,60)
    arrow(v,'find',[(510,435),(370,435)]); v.txt('Find options\n[valid inputs]',372,359,135,65)
    arrow(v,'edit',[(190,355),(190,280),(595,280),(595,355)]); v.txt('Edit plan',272,285,190,34)
    arrow(v,'opencompare',[(370,490),(440,490),(440,605),(1140,605),(1140,540)]); v.txt('Compare [2–3 options] or reconfigure',545,565,390,35)
    arrow(v,'recalc',[(1140,355),(1140,255),(260,255),(260,355)]); v.txt('Recalculate [valid] / new version',770,210,350,35)
    arrow(v,'refresh',[(30,435),(8,435),(8,580),(160,580),(160,540)]); v.txt('Refresh /\nnew version',15,587,160,56)
    v.txt('At every calculation: generate and rank → apply active Moderator faulty filter → form shortlist. Failure shows an in-state error without a partial version.',890,45,400,150)
    v.txt('M-01 and M-02 are responsive renderings of D-02 and D-03. In-state validation, reset and failure paths are specified in the transition table. Any authenticated state: sign out/session expiry → D-00. Moderator login → D-06 (next map).',30,680,1260,95)
    return v

def report_dialog():
    v=View('Reporting and moderation UI Dialog Map')
    state(v,'context','D-03 or M-02','Selected station / connector',30,45,330,130)
    state(v,'report','D-05 Issue Report','Form / duplicate / validation\nPending acknowledgement + reference',540,45,400,170)
    arrow(v,'open',[(360,105),(540,105)]); v.txt('Report an Issue',360,60,180,35)
    arrow(v,'cancel',[(680,215),(680,265),(190,265),(190,175)]); v.txt('Cancel / return to station',270,220,315,35)
    arrow(v,'submit',[(940,120),(1250,120),(1250,240),(870,240),(870,215)]); v.txt('Submit [valid] /\nPending confirmation\nNo station exclusion',965,155,260,75)
    v.box('separator','',25,320,1280,1,'fillColor=#CBD5E1;strokeColor=#CBD5E1;')
    state(v,'auth','D-00 Account Access','Moderator sign-in',30,390,330,130)
    state(v,'moderate','D-06 Moderator Review','Queue / report details / audit history\nDecision confirmation / success\nReason error / conflict and retry',540,385,440,200)
    arrow(v,'login',[(360,455),(540,455)]); v.txt('valid Moderator\nsession',365,390,165,55)
    arrow(v,'decision',[(980,455),(1260,455),(1260,625),(850,625),(850,585)]); v.txt('Decide [authorized, reason,\ncurrent report] / update\nD-06 status and audit',995,500,280,95)
    v.txt('The stored Pending report becomes available in the Moderator queue. This data effect is not a Driver-to-Moderator screen transition.',30,292,1270,45)
    v.txt('D-06 keeps the same screen for Verify, Reject, Merge, Resolve and Expire. Fault support changes affect later generation/recalculation/manual refresh. Missing reason or concurrent update blocks the decision and leaves D-06 visible.',30,675,1270,80)
    return v

def main():
    items=[(usecases(),'01-use-case-diagram','usecase','1 Complete Use Case Diagram','All eight use cases. External Data Providers groups OneMap and LTA DataMall as supporting roles; provider participation includes reconfiguration when route/data work is needed.'),(collaborations(),'04-boundary-control-classes','boundary','3 Key Boundary and Control Classes','Representative boundary–control–entity collaborations. The complete object and attribute catalogue follows the diagrams.'),(driver_dialog(),'05-state-machine-driver','dialog','4 Initial Dialog Map Driver Journey','Nodes are UI states. M-01 and M-02 share the logical states of D-02 and D-03; validation and manual refresh are UI state transitions.'),(report_dialog(),'06-state-machine-reports-moderation','dialog','4 Initial Dialog Map Reporting and Moderation','Driver and Moderator journeys are separated by role. Report lifecycle changes appear as variants of the report/review UI, not as screen transfers between users.')]
    manifest=[]
    for view,stem,section,title,caption in items:
        view.save(stem); manifest.append(dict(section=section,file='diagrams/'+stem+'.drawio.png',title=title,caption=caption))
    entity=json.loads((OUT/'entity-manifest.json').read_text(encoding='utf-8'))
    (OUT/'manifest.json').write_text(json.dumps(manifest[:1]+entity+manifest[1:],indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()

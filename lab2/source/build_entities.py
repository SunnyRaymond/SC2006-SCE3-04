"""Readable conceptual UML views with native editable draw.io shapes."""
from pathlib import Path
from xml.etree import ElementTree as E
import subprocess, json, html

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'diagrams'
class View:
    def __init__(self,title):
        self.xml=E.Element('mxfile',host='app.diagrams.net')
        dg=E.SubElement(self.xml,'diagram',name=title,id=title.replace(' ','-'))
        model=E.SubElement(dg,'mxGraphModel',page='1',pageWidth='1320',pageHeight='740',background='#FFFFFF')
        self.root=E.SubElement(model,'root'); E.SubElement(self.root,'mxCell',id='0'); E.SubElement(self.root,'mxCell',id='1',parent='0')
        self.n=0
    def box(self,id,text,x,y,w,h,style):
        cell=E.SubElement(self.root,'mxCell',id=id,value=text,style=style,vertex='1',parent='1')
        E.SubElement(cell,'mxGeometry',x=str(x),y=str(y),width=str(w),height=str(h),**{'as':'geometry'})
    def cls(self,id,name,attrs,x,y,w,h):
        self.box(id,'',x,y,w,h,'rounded=0;fillColor=#FFFFFF;strokeColor=#475569;strokeWidth=1.5;')
        self.box(id+'head','«entity»\n'+name,x,y,w,55,'text;whiteSpace=wrap;align=center;verticalAlign=middle;fontSize=18;fontStyle=1;fillColor=#EAF0F5;strokeColor=#475569;')
        self.box(id+'body','\n'.join(attrs),x+12,y+64,w-24,h-70,'text;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=17;fontFamily=Arial;spacing=0;')
    def txt(self,text,x,y,w=180,h=26):
        self.n+=1; self.box('txt'+str(self.n),text,x,y,w,h,'text;whiteSpace=wrap;align=center;verticalAlign=middle;fontSize=16;fontFamily=Arial;fillColor=#FFFFFF;strokeColor=none;')
    def edge(self,id,pts,kind=None):
        style='endArrow=none;strokeColor=#475569;strokeWidth=1.7;rounded=0;'
        if kind=='composition': style+='startArrow=diamond;startFill=1;startSize=14;'
        if kind=='aggregation': style+='startArrow=diamond;startFill=0;startSize=14;'
        cell=E.SubElement(self.root,'mxCell',id=id,edge='1',parent='1',style=style)
        geo=E.SubElement(cell,'mxGeometry',relative='1',**{'as':'geometry'})
        E.SubElement(geo,'mxPoint',x=str(pts[0][0]),y=str(pts[0][1]),**{'as':'sourcePoint'})
        E.SubElement(geo,'mxPoint',x=str(pts[-1][0]),y=str(pts[-1][1]),**{'as':'targetPoint'})
        if len(pts)>2:
            a=E.SubElement(geo,'Array',**{'as':'points'})
            for x,y in pts[1:-1]: E.SubElement(a,'mxPoint',x=str(x),y=str(y))
    def save(self,stem):
        path=OUT/(stem+'.drawio'); E.indent(self.xml); path.write_bytes(E.tostring(self.xml,encoding='utf-8',xml_declaration=True))
        png=OUT/(stem+'.drawio.png')
        args=f'-x -f png -e -b 16 -s 2 -o "{png}" "{path}"'
        def quote(s): return "'"+str(s).replace("'","''")+"'"
        cmd=f"$entityProcess=Start-Process -FilePath 'C:\\Program Files\\draw.io\\draw.io.exe' -ArgumentList {quote(args)} -WindowStyle Hidden -Wait -PassThru; exit $entityProcess.ExitCode"
        subprocess.run(['powershell.exe','-NoProfile','-Command',cmd],check=True)
        assert png.exists() and png.stat().st_size>1000

def ownership():
    v=View('Ownership and immutable planning')
    v.cls('user','User',['userId; email {unique}','passwordHash; status','role {DRIVER, MODERATOR}'],40,40,330,180)
    v.cls('profile','EVProfile',['profileId; usableCapacityKWh','consumptionKWhPer100Km','plugTypes; maxACPowerKW','maxDCPowerKW; reserveSOCPercent','D-01 profile preferences'],40,370,330,240)
    v.cls('plan','ChargingPlan',['planId; status; createdAt','current selection:','(versionId, recommendationId)?'],530,40,380,180)
    v.cls('version','PlanVersion',['versionId; versionNumber; createdAt','origin; destination; departureAt','currentSOCPercent','maximumChargingMinutes','maximumDetourMinutes; strategy','manualTargetSOCPercent?','copied vehicle assumptions','faultFilterCheckedAt; faultEvidenceRefs?','{immutable calculation record}'],530,330,430,310)
    v.edge('ownsplan',[(370,130),(530,130)]); v.txt('1',377,98,35); v.txt('0..*',475,98,50); v.txt('owns',410,138,80)
    v.edge('ownsprofile',[(205,220),(205,370)]); v.txt('1',212,225,35); v.txt('0..1',212,335,55); v.txt('owns',212,273,80)
    v.edge('versions',[(720,220),(720,330)],'composition'); v.txt('1',727,228,35); v.txt('1..*',727,294,50); v.txt('versions',580,255,125)
    v.edge('profilelink',[(370,490),(440,490),(440,260),(530,260),(530,190)]); v.txt('0..1',373,455,60); v.txt('0..*',470,265,60); v.txt('current profile',373,301,125,50)
    v.txt('Role constraints\nOnly a Driver owns a profile or plan.\nModerator uses User in the moderation view.',1000,40,280,145)
    v.txt('A Driver may have no profile before setup or after deletion. A valid profile is required to create a plan.',1000,230,280,140)
    v.txt('Current selection is mutable at plan level and identifies an eligible recommendation in one of this plan’s versions. Updating selection does not edit a PlanVersion.',1000,420,280,180)
    v.txt('Solid line: association     Filled diamond: composition     ? optional     All detailed attributes and ranges are in the entity catalogue.',40,670,1240,40)
    return v

def calculation():
    v=View('Calculation results and evidence')
    v.cls('version','PlanVersion',['versionId; immutable inputs','faultFilterCheckedAt','faultEvidenceRefs?'],40,40,330,180)
    v.cls('snapshot','OfficialSnapshot',['snapshotId; source','observedAt; retrievedAt','dataState {LIVE, CACHED,','STALE, DEMO_FIXTURE}'],890,40,390,195)
    v.cls('route','RouteEstimate',['routeId; origin; destination','distanceKm; durationMinutes','retrievedAt'],40,390,330,200)
    v.cls('rec','Recommendation',['recommendationId; feasibility','arrivalSOC; automaticTargetSOC','requiredEnergyKWh; chargingMinutes','estimatedCost?; detourMinutes','availabilitySummary; explanation','rankBeforeFaultFilter; rank?','shortlistState; filterReason?'],490,340,390,280)
    v.cls('connector','Connector',['connectorId; plugType; currentType','maximumPowerKW; official status','priceType; unitPrice?'],1000,390,280,200)
    v.edge('snapshotlink',[(370,130),(890,130)]); v.txt('0..*',385,97,60); v.txt('1',844,97,35); v.txt('uses exact snapshot',540,138,220)
    v.edge('routes',[(205,220),(205,390)],'composition'); v.txt('1',215,225,35); v.txt('1..*',215,350,55); v.txt('route legs',210,290,110)
    v.edge('results',[(370,190),(420,190),(420,480),(490,480)],'composition'); v.txt('1',382,196,30); v.txt('0..*',432,443,55); v.txt('results',372,298,100)
    v.edge('connectorlink',[(880,500),(1000,500)]); v.txt('0..*',884,466,50); v.txt('1',961,466,35); v.txt('assesses',890,505,100)
    v.txt('Order of operations\nCalculate and rank suggestions → filter Moderator-marked faulty stations → form shortlist.\nThe next-ranked unmarked candidates fill up to three places when available.',440,40,415,80)
    v.txt('shortlistState = SURVIVES, FILTERED_FAULT or HARD_EXCLUDED. Zero/one eligible result is explained. RouteEstimate belongs to one version; each Recommendation assesses one Connector.',390,640,880,75)
    return v

def moderation():
    v=View('Station inventory and moderation')
    v.cls('station','ChargingStation',['stationId; name; address','latitude; longitude; operator','operatingHours; /isFaultyAt(t)'],40,40,420,190)
    v.cls('report','IssueReport',['reportId; category; note; imageReference?','status; createdAt; expiresAt','/faultSupportAt(t)','station target; optional connector target'],800,40,480,210)
    v.cls('connector','Connector',['connectorId; plugType; currentType','maximumPowerKW; official status','priceType; unitPrice?'],40,440,380,190)
    v.cls('decision','ModerationDecision',['decisionId; action; reason','createdAt; resultingStatus'],820,440,460,170)
    v.cls('user','User',['userId; role'],480,440,190,150)
    v.edge('inventory',[(225,230),(225,440)],'aggregation'); v.txt('1',235,240,35); v.txt('1..*',235,400,55); v.txt('contains',240,320,110)
    v.edge('stationreports',[(460,140),(800,140)]); v.txt('1',466,106,35); v.txt('0..*',740,106,55); v.txt('reports',550,147,160)
    v.edge('target',[(420,530),(445,530),(445,290),(760,290),(760,210),(800,210)]); v.txt('0..1',430,540,45); v.txt('0..*',738,216,55); v.txt('optional connector target',490,261,245,26)
    v.edge('audit',[(1050,250),(1050,440)],'composition'); v.txt('1',1060,260,35); v.txt('0..*',1060,402,55); v.txt('audit history',1060,332,175)
    v.edge('reporter',[(610,440),(610,370),(780,370),(780,180),(800,180)]); v.txt('1',615,405,35); v.txt('0..*',735,145,55); v.txt('reporter {Driver}',605,374,175,26)
    v.edge('moderator',[(670,525),(820,525)]); v.txt('1',675,535,30); v.txt('0..*',770,535,43); v.txt('actor {Moderator}',673,490,145,30)
    v.txt('/isFaultyAt(t) is derived from at least one VERIFIED, unexpired faulty report. A connector report affects its parent station. Pending/non-fault reports never exclude. Resolve/expiry removes only that report’s support; merge retains canonical support.',40,655,1240,70)
    return v

def main():
    OUT.mkdir(exist_ok=True)
    items=[(ownership(),'entity-01-ownership','2 Class diagram of entity classes Ownership','Driver ownership, optional current profile, version composition and mutable version-qualified selection.'),
           (calculation(),'entity-02-calculation','2 Class diagram of entity classes Calculation','Immutable calculation results, exact provider evidence, route legs and connector assessments. Repeated classes are the same entities across views.'),
           (moderation(),'entity-03-moderation','2 Class diagram of entity classes Moderation','Physical inventory, issue targets and audit history. The station faulty mark is derived from existing report/decision evidence.')]
    manifest=[]
    for view,stem,title,caption in items:
        view.save(stem); manifest.append(dict(section='entity',file='diagrams/'+stem+'.drawio.png',title=title,caption=caption))
    (OUT/'entity-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__': main()


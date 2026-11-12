import json, sys, collections

def intervals(thread):
    names = thread['stringTable']; pending = collections.defaultdict(list)
    for row in thread['markers']['data']:
        name, start, end, phase = names[row[0]], row[1], row[2], row[3]
        if phase == 1 and start is not None and end is not None and end >= start:
            yield name, start, end
        elif phase == 2: pending[name].append(start)
        elif phase == 3 and pending[name]:
            start = pending[name].pop()
            if end >= start: yield name, start, end

def processes(profile):
    yield profile
    for child in profile.get('processes', []): yield from processes(child)

for filename in sys.argv[1:]:
    profile = json.load(open(filename)); procs = list(processes(profile))
    target = next((p,t) for p in procs for t in p.get('threads',[]) if any('qa-idle-start' in str(row[-1]) for row in t['markers']['data']))
    proc, thread = target
    marks = {row[-1]['name']: row[1] for row in thread['markers']['data'] if isinstance(row[-1],dict) and isinstance(row[-1].get('name'),str) and row[-1]['name'].startswith('qa-')}
    phases = [('idle','qa-idle-start','qa-scroll-start'),('down','qa-scroll-start','qa-scroll-end'),('up','qa-scroll-end','qa-up-end')]
    result = {'file':filename,'phases':{}}
    for phase, before, after in phases:
        begin, finish = marks[before], marks[after]; seconds = (finish-begin)/1000
        summary = {}
        for p in procs:
            for t in p.get('threads',[]):
                if t is not thread and t['name'] not in ['Renderer','Compositor','WRSceneBuilder#0','WRRenderBackend#0']: continue
                offset = p['meta']['startTime']-proc['meta']['startTime']
                timers = collections.defaultdict(list)
                for name,start,end in intervals(t):
                    start += offset; end += offset
                    if start < finish and end > begin: timers[name].append(max(0,min(end,finish)-max(start,begin)))
                records = sorted([{'name':name,'msPerSecond':round(sum(v)/seconds,2),'count':len(v),'maxMs':round(max(v),2)} for name,v in timers.items()], key=lambda d:-d['msPerSecond'])[:14]
                value={'markers':records}
                if t is thread:
                    samples=t['samples']; schema=samples['schema']; stacks=t['stackTable']; frames=t['frameTable']; names=t['stringTable']; cats=collections.Counter(); leaf=collections.Counter()
                    for row in samples['data']:
                        if not begin <= row[schema['time']] <= finish or row[schema['stack']] is None: continue
                        stack=stacks['data'][row[schema['stack']]]; frame=frames['data'][stack[stacks['schema']['frame']]]
                        weight=(row[schema['threadCPUDelta']] or 0)/1000000
                        category_column=frames['schema']['category']
                        category=frame[category_column] if len(frame)>category_column else None
                        cats[profile['meta']['categories'][category]['name'] if category is not None else 'Uncategorized']+=weight
                        leaf[names[frame[frames['schema']['location']]]]+=weight
                    value['cpuMsPerSecond']={name:round(ms/seconds,2) for name,ms in cats.most_common()}
                    value['topLeaves']=[(name,round(ms/seconds,2)) for name,ms in leaf.most_common(18)]
                summary[t['name']]=value
        result['phases'][phase]={'seconds':seconds,'threads':summary}
    print(json.dumps(result,ensure_ascii=False,indent=2))

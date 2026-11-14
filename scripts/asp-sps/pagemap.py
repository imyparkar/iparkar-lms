# Usage: python3 scripts/asp-sps/pagemap.py guide.txt pagemap.json
# guide.txt = text of iParkar-ASP-Exam-Study-Guide.pdf (both halves joined with a newline).
import re, json, sys
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
starts=[i for i,l in enumerate(lines) if l.startswith('iParkar Learning · ASP® Exam Study Guide')]
nums={}
for s in starts:
    for j in range(s, min(s+3,len(lines))):
        m=re.search(r'Edition 1\.0 · November 2026 (\d+)$', lines[j])
        if m: nums[s]=int(m.group(1)); break
# infer
pg={}
for k,s in enumerate(starts):
    if s in nums: pg[s]=nums[s]
    else:
        # look forward
        for k2 in range(k+1,len(starts)):
            if starts[k2] in nums: pg[s]=nums[starts[k2]]-(k2-k); break
# check monotonic
prev=0;bad=[]
for s in starts:
    if pg[s]!=prev+1: bad.append((s,prev,pg[s]))
    prev=pg[s]
print('pages',len(starts),'first',pg[starts[0]],'last',pg[starts[-1]],'gaps',bad[:20])
import bisect
def page_of(line):
    k=bisect.bisect_right(starts,line)-1
    return pg[starts[k]] if k>=0 else 1
json.dump({'starts':starts,'pg':[pg[s] for s in starts]},open(sys.argv[2],'w'))

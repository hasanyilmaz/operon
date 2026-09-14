import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ListItemCache } from 'obsidian';
import type { IndexedTask } from '../src/types/fields';
import { nativeListDepths, inlineTaskIndentLevels, applyReadingInlineIndent } from '../src/ui/inline-task-indent';
const task = (id: string, line: number, parent = ''): IndexedTask => ({
 operonId:id, datetimeModified:'', fieldValues:{parentTask:parent}, checkbox:'open', description:id, tags:[], tier:'hot',
 primary:{filePath:'Tasks.md',lineNumber:line,format:'inline'},
});
const depths = (values: number[]) => new Map(values.map((depth,line) => [line,depth]));
const rank = (tasks: IndexedTask[], values = tasks.map(() => 0)) => [...inlineTaskIndentLevels(tasks,'Tasks.md',depths(values))];
test('native roots at line zero and nested ordinary items', () => {
 const items = [[0,0],[1,0],[2,1],[3,0],[4,-4]].map(([line,parent]) => ({position:{start:{line}},parent}) as ListItemCache);
 assert.deepEqual([...nativeListDepths(items)],[[0,0],[1,1],[2,2],[3,1],[4,0]]);
});
test('siblings and grandchildren follow relationship depth without source writes', () => {
 const tasks = [task('a',0),task('b',1,'a'),task('c',2,'a'),task('d',3,'b')];
 const before = JSON.stringify(tasks);
 assert.deepEqual(rank(tasks),[['b',1],['c',1],['d',2]]);
 assert.equal(JSON.stringify(tasks),before);
});
test('existing nesting is not doubled and larger native indentation is preserved', () => {
 const tasks = [task('a',0),task('b',1,'a'),task('c',2,'b')];
 assert.deepEqual(rank(tasks,[0,1,2]),[]);
 assert.deepEqual(rank(tasks,[0,3,4]),[]);
 assert.deepEqual(rank(tasks,[1,0,1]),[['b',2],['c',2]]);
});
test('missing, later, other-file and file parents cannot add a level', () => {
 const a = task('a',0,'missing'), b = task('b',1,'c'), c = task('c',2);
 assert.deepEqual(rank([a,b,c]),[]);
 c.primary.filePath='Other.md'; b.fieldValues.parentTask='c';
 assert.deepEqual(rank([a,b,c]),[]);
 c.primary.filePath='Tasks.md'; c.primary.format='yaml'; c.primary.lineNumber=0;
 assert.deepEqual(rank([a,b,c]),[]);
});
test('cycles and descendants leading into cycles have no added indentation', () => {
 assert.deepEqual(rank([task('a',0,'b'),task('b',1,'a'),task('c',2,'b')]),[]);
 assert.deepEqual(rank([task('a',0,'a')]),[]);
});
test('missing metadata fails closed and parent removal refreshes depth', () => {
 const tasks = [task('a',0),task('b',1,'a')];
 assert.deepEqual([...inlineTaskIndentLevels(tasks,'Tasks.md',new Map())],[]);
 assert.deepEqual(rank(tasks),[['b',1]]);
 tasks[1].fieldValues.parentTask='';
 assert.deepEqual(rank(tasks),[]);
});
test('status and timer updates keep indentation and only row decoration changes', () => {
 const tasks = [task('a',0),task('b',1,'a')];
 const expected = rank(tasks);
 tasks[1].checkbox='done'; tasks[1].fieldValues.timeTracked='1m';
 assert.deepEqual(rank(tasks),expected);
 const children = [Object.freeze({chip:'timer'})];
 const classes = new Set<string>(); const styles = new Map<string,string>();
 const row = {children, classList:{toggle:(name:string,on:boolean) => on?classes.add(name):classes.delete(name)},
 style:{setProperty:(key:string,value:string)=>styles.set(key,value),removeProperty:(key:string)=>styles.delete(key)}};
 applyReadingInlineIndent(row as unknown as HTMLElement,2);
 assert.equal(styles.get('--operon-inline-indent-levels'),'2');
 applyReadingInlineIndent(row as unknown as HTMLElement,0);
 assert.equal(classes.size,0); assert.equal(styles.size,0); assert.equal(row.children,children);
});

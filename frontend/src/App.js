import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  CloudUpload,
  Database,
  FileArchive,
  FileCode2,
  Layers3,
  Link2,
  LoaderCircle,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { traceImpact } from './impactAnalysis';
import './App.css';

const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const uploadLimit = 25 * 1024 * 1024;
const scenarioOptions = [
  { id: 'failure', label: 'Failure' },
  { id: 'update', label: 'Update' },
  { id: 'removal', label: 'Removal' },
];

function InfrastructureNode({ data, selected }) {
  const Icon = data.kind === 'module' ? Layers3 : data.kind === 'data' ? Database : Box;
  return (
    <article className={`infra-node kind-${data.kind}${selected ? ' is-selected' : ''}${data.impactRole ? ` is-${data.impactRole}` : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="infra-node-icon"><Icon size={16} strokeWidth={1.8} /></div>
      <div className="infra-node-copy">
        <span className="infra-node-kind">{data.kind === 'data' ? 'DATA SOURCE' : data.kind.toUpperCase()}</span>
        <strong title={data.address}>{data.name}</strong>
        <span className="infra-node-type">{data.kind === 'module' ? data.moduleSource || 'Terraform module' : data.type}</span>
      </div>
      {data.change && data.change.action !== 'no-op' && (
        <span className={`change-dot change-${data.change.action}`} title={`Planned ${data.change.action}`} />
      )}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function EvidenceEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, style }) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <span
          className={`edge-label${data?.direction ? ` edge-label-${data.direction}` : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
        >
          {data?.type === 'explicit_depends_on' ? 'DEPENDS_ON' : 'REFERENCE'}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { infrastructure: InfrastructureNode };
const edgeTypes = { evidence: EvidenceEdge };

function layoutGraph(nodes, edges) {
  const dependents = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    if (!dependents.has(edge.source) || !incoming.has(edge.target)) return;
    dependents.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  });

  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const remaining = new Map(incoming);
  while (queue.length) {
    const current = queue.shift();
    for (const dependent of dependents.get(current) || []) {
      levels.set(dependent, Math.max(levels.get(dependent), levels.get(current) + 1));
      remaining.set(dependent, remaining.get(dependent) - 1);
      if (remaining.get(dependent) === 0) queue.push(dependent);
    }
  }

  const maxLevel = Math.max(0, ...levels.values());
  nodes.forEach((node) => {
    if (remaining.get(node.id) > 0) levels.set(node.id, maxLevel + 1);
  });
  const rows = new Map();
  return nodes.map((node) => {
    const level = levels.get(node.id) || 0;
    const row = rows.get(level) || 0;
    rows.set(level, row + 1);
    return {
      id: node.id,
      type: 'infrastructure',
      position: { x: 100 + level * 330, y: 80 + row * 135 },
      data: { ...node },
    };
  });
}

function formatAction(action) {
  return action === 'replace' ? 'replace' : action;
}

function App() {
  const fileInput = useRef(null);
  const [analysis, setAnalysis] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [scenario, setScenario] = useState('failure');
  const [simulation, setSimulation] = useState(null);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submitArchive = useCallback(async (file) => {
    setError('');
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      setError('Choose a .zip archive.');
      return;
    }
    if (file.size > uploadLimit) {
      setError('The ZIP archive must be 25 MB or smaller.');
      return;
    }

    const payload = new FormData();
    payload.append('archive', file);
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/analyze`, { method: 'POST', body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ? `${result.error} ${result.detail}` : result.error);
      setAnalysis(result);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSimulation(null);
      setSearch('');
    } catch (requestError) {
      setError(requestError.message || 'The archive could not be analyzed. Check that the backend is running.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, []);

  const impact = useMemo(() => {
    if (!simulation || !analysis) return null;
    return traceImpact(simulation.nodeId, analysis.edges);
  }, [analysis, simulation]);

  const graphNodes = useMemo(() => {
    if (!analysis) return [];
    const normalized = layoutGraph(analysis.nodes, analysis.edges);
    const query = search.trim().toLowerCase();
    return normalized.map((node) => {
      const matches = !query || [node.data.address, node.data.type, node.data.name, node.data.displayName]
        .filter(Boolean).some((value) => value.toLowerCase().includes(query));
      const impactRole = impact?.affected.has(node.id)
        ? 'affected'
        : impact?.prerequisites.has(node.id) ? 'prerequisite' : undefined;
      return { ...node, data: { ...node.data, impactRole }, style: { opacity: matches ? 1 : 0.16 } };
    });
  }, [analysis, impact, search]);

  const graphEdges = useMemo(() => {
    if (!analysis) return [];
    const query = search.trim().toLowerCase();
    const matchingIds = new Set(graphNodes.filter((node) => node.style.opacity === 1).map((node) => node.id));
    return analysis.edges.map((edge) => {
      const direction = impact?.pathEdges.has(edge.id)
        ? 'impact'
        : impact?.prerequisiteEdges.has(edge.id) ? 'prerequisite' : undefined;
      const matchesSearch = !query || matchingIds.has(edge.source) || matchingIds.has(edge.target);
      const activeEvidence = selectedEdgeId === edge.id;
      return {
        ...edge,
        type: 'evidence',
        data: { type: edge.type, direction },
        style: {
          stroke: direction === 'impact' ? '#b7422f' : direction === 'prerequisite' ? '#8d6315' : activeEvidence ? '#21715a' : '#b7c5bc',
          strokeWidth: direction || activeEvidence ? 2.5 : 1.25,
          opacity: matchesSearch ? 1 : 0.12,
        },
      };
    });
  }, [analysis, graphNodes, impact, search, selectedEdgeId]);

  const selectedNode = analysis?.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = analysis?.edges.find((edge) => edge.id === selectedEdgeId);
  const nodeById = useMemo(() => new Map((analysis?.nodes || []).map((node) => [node.id, node])), [analysis]);
  const directDependencies = analysis?.edges.filter((edge) => edge.target === selectedNodeId) || [];
  const directDependents = analysis?.edges.filter((edge) => edge.source === selectedNodeId) || [];

  const selectNode = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setSimulation(null);
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    setDragging(false);
    submitArchive(event.dataTransfer.files?.[0]);
  }, [submitArchive]);

  const startSimulation = () => {
    if (!selectedNode) return;
    setSimulation({ nodeId: selectedNode.id, scenario });
    setSelectedEdgeId(null);
  };

  const openPicker = () => fileInput.current?.click();

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Infrastructure Blast-Radius Detector home">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.2} /></span>
          <span className="brand-name">BLAST<span>RADIUS</span></span>
          <span className="brand-divider" />
          <span className="brand-product">Infrastructure detector</span>
        </a>
        <div className="topbar-right">
          {analysis && <span className="archive-label"><FileArchive size={14} />{analysis.archiveName}</span>}
          {analysis && <button className="quiet-button" onClick={openPicker}><Upload size={15} /> New archive</button>}
          <span className="api-status"><span />LOCAL ANALYSIS</span>
        </div>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => submitArchive(event.target.files?.[0])}
        />
      </header>

      {!analysis ? (
        <main className="welcome-screen" id="top">
          <div className="welcome-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> INFRASTRUCTURE ANALYSIS / 01</div>
            <h1>See what sits<br /><em>downstream.</em></h1>
            <p className="welcome-description">Map Terraform dependencies and explore the potential impact of a resource change.</p>
            <div className={`upload-zone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={openPicker}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openPicker(); }}
              role="button"
              tabIndex={0}
              aria-label="Upload a Terraform ZIP archive"
            >
              <div className="upload-symbol">{busy ? <LoaderCircle className="spin" size={22} /> : <CloudUpload size={23} />}</div>
              <div className="upload-copy">
                <strong>{busy ? 'Reading Terraform files' : 'Drop a Terraform ZIP here'}</strong>
                <span>{busy ? 'Parsing declarations and references…' : 'or choose an archive from your files'}</span>
              </div>
              {!busy && <span className="upload-action">Browse <ArrowRight size={14} /></span>}
              <span className="upload-limit">ZIP <i /> MAX 25 MB</span>
            </div>
            {error && <div className="error-message" role="alert"><AlertTriangle size={15} />{error}</div>}
            <div className="format-note"><FileCode2 size={15} /> Looks for <code>.tf</code>, <code>.tf.json</code> and optional plan JSON.</div>
          </div>
          <aside className="welcome-aside">
            <div className="aside-index">ANALYSIS FLOW <span>3 STEPS</span></div>
            <ol className="steps-list">
              <li><span className="step-number">01</span><div><strong>Upload configuration</strong><small>Terraform files stay in this workspace.</small></div><Check size={15} /></li>
              <li><span className="step-number">02</span><div><strong>Resolve references</strong><small>Edges keep the expression and file.</small></div><Check size={15} /></li>
              <li><span className="step-number">03</span><div><strong>Trace potential impact</strong><small>Follow direct and indirect dependents.</small></div><ArrowDownRight size={15} /></li>
            </ol>
            <div className="caveat-box"><ShieldAlert size={17} /><p><strong>Evidence, not certainty.</strong> Terraform references suggest possible impact; they do not guarantee runtime dependencies or outages.</p></div>
          </aside>
          <div className="welcome-footer"><span>BLAST RADIUS DETECTOR</span><span>CONFIGURATION-IN / EVIDENCE-OUT</span></div>
        </main>
      ) : (
        <main className="workspace" id="top">
          <section className="workspace-heading">
            <div className="workspace-title"><span className="eyebrow"><span className="eyebrow-line" /> DEPENDENCY WORKSPACE</span><h1>{analysis.archiveName}</h1></div>
            <div className="summary-strip" aria-label="Terraform analysis summary">
              <div><strong>{analysis.summary.resources}</strong><span>RESOURCES</span></div>
              <div><strong>{analysis.summary.dataSources}</strong><span>DATA SOURCES</span></div>
              <div><strong>{analysis.summary.modules}</strong><span>MODULES</span></div>
              <div><strong>{analysis.summary.dependencies}</strong><span>REFERENCES</span></div>
              {analysis.summary.plannedChanges > 0 && <div className="summary-planned"><strong>{analysis.summary.plannedChanges}</strong><span>PLAN CHANGES</span></div>}
            </div>
          </section>

          <div className="caveat-strip"><ShieldAlert size={15} /><span><strong>Potential impact only.</strong> Edges reflect parsed Terraform evidence, not guaranteed runtime dependencies or outage certainty.</span></div>

          <section className="explorer-layout">
            <div className="graph-column">
              <div className="graph-toolbar">
                <div className="graph-heading"><h2>Dependency map</h2><span>{analysis.nodes.length} objects <i /> {analysis.edges.length} references</span></div>
                <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a resource" aria-label="Find a resource" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</label>
              </div>
              <div className="graph-canvas">
                {analysis.nodes.length === 0 ? (
                  <div className="empty-graph"><CircleHelp size={22} /><strong>No graphable resources found</strong><span>Upload a ZIP with Terraform resource, data, or module blocks.</span></div>
                ) : (
                  <ReactFlow
                    key={analysis.archiveName}
                    nodes={graphNodes}
                    edges={graphEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodeClick={selectNode}
                    onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); setSimulation(null); }}
                    onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    minZoom={0.2}
                    maxZoom={1.6}
                    nodesConnectable={false}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background color="#cbd4cd" gap={20} size={1} />
                    <Controls position="bottom-left" showInteractive={false} />
                    <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => node.data.kind === 'module' ? '#d6a64f' : node.data.kind === 'data' ? '#5596a0' : '#5a9478'} maskColor="rgba(242, 246, 241, 0.78)" />
                  </ReactFlow>
                )}
                  <div className="graph-legend"><span><i className="legend-resource" />RESOURCE</span><span><i className="legend-data" />DATA SOURCE</span><span><i className="legend-module" />MODULE</span>{simulation && <><span><i className="legend-affected" />MAY BE AFFECTED</span><span><i className="legend-prerequisite" />UPSTREAM</span></>}</div>
              </div>
              <div className="file-manifest"><FileCode2 size={14} /><span>{analysis.files.length} source files parsed</span><span className="manifest-separator">/</span><span title={analysis.files.join('\n')}>{analysis.files.slice(0, 2).join(', ')}{analysis.files.length > 2 ? ` +${analysis.files.length - 2} more` : ''}</span></div>
            </div>

            <aside className="inspector">
              {selectedNode ? (
                <>
                  <div className="inspector-kicker"><span>RESOURCE INSPECTOR</span><button className="icon-button" onClick={() => setSelectedNodeId(null)} aria-label="Close inspector"><X size={16} /></button></div>
                  <div className="inspected-title"><span className={`inspected-icon kind-${selectedNode.kind}`}>{selectedNode.kind === 'module' ? <Layers3 size={18} /> : selectedNode.kind === 'data' ? <Database size={18} /> : <Box size={18} />}</span><div><small>{selectedNode.kind === 'data' ? 'DATA SOURCE' : selectedNode.kind.toUpperCase()}</small><h2>{selectedNode.name}</h2></div></div>
                  <code className="resource-address">{selectedNode.address}</code>
                  {selectedNode.displayName && <div className="detail-row"><span>Display name</span><strong>{selectedNode.displayName}</strong></div>}
                  <div className="detail-row"><span>Declared in</span><strong title={selectedNode.file}>{selectedNode.file}</strong></div>
                  {selectedNode.moduleSource && <div className="detail-row"><span>Module source</span><strong>{selectedNode.moduleSource}</strong></div>}
                  {selectedNode.change && <div className={`planned-change change-${formatAction(selectedNode.change.action)}`}><span>PLAN ACTION</span><strong>{formatAction(selectedNode.change.action)}</strong></div>}
                  <div className="connection-counts"><div><strong>{directDependencies.length}</strong><span>DEPENDS ON</span></div><div><strong>{directDependents.length}</strong><span>REFERENCED BY</span></div></div>
                  <div className="inspector-divider" />
                  <div className="scenario-heading"><SlidersHorizontal size={15} /><span>HYPOTHETICAL SCENARIO</span></div>
                  <div className="scenario-switch" role="group" aria-label="Potential impact scenario">
                    {scenarioOptions.map((option) => <button key={option.id} className={scenario === option.id ? 'active' : ''} onClick={() => { setScenario(option.id); setSimulation(null); }}>{option.label}</button>)}
                  </div>
                  <button className="simulate-button" onClick={startSimulation}><Activity size={16} /> Trace potential impact <ArrowRight size={15} /></button>
                  {simulation && impact && <div className="impact-result" aria-live="polite">
                    <div className="impact-title"><span><AlertTriangle size={15} /> POTENTIAL IMPACT</span><strong>{impact.affected.size}</strong></div>
                    <p>{impact.affected.size === 0 ? 'No downstream references were found in the parsed configuration.' : `${impact.affected.size} downstream ${impact.affected.size === 1 ? 'object may' : 'objects may'} be affected by a ${simulation.scenario}.`}</p>
                    {impact.prerequisites.size > 0 && <div className="prerequisite-note"><strong>{impact.prerequisites.size} UPSTREAM {impact.prerequisites.size === 1 ? 'DEPENDENCY' : 'DEPENDENCIES'}</strong><span>Required by the selected object; shown for context, not counted as impact from its failure.</span></div>}
                    {impact.paths.length > 0 && <div className="impact-paths">{impact.paths.slice(0, 5).map((path) => <div key={path.join('>')}><span>{path.map((id) => nodeById.get(id)?.name || id).join('  →  ')}</span></div>)}{impact.paths.length > 5 && <small>and {impact.paths.length - 5} more paths</small>}</div>}
                  </div>}
                  <div className="dependency-list">
                    <div className="list-heading">DIRECT UPSTREAM DEPENDENCIES <span>{directDependencies.length}</span></div>
                    {directDependencies.length ? directDependencies.map((edge) => <button key={edge.id} onClick={() => setSelectedNodeId(edge.source)}><span className="dependency-bullet" />{nodeById.get(edge.source)?.address || edge.source}<ChevronRight size={14} /></button>) : <p>No direct references to other parsed objects.</p>}
                  </div>
                </>
              ) : selectedEdge ? (
                <>
                  <div className="inspector-kicker"><span>EDGE EVIDENCE</span><button className="icon-button" onClick={() => setSelectedEdgeId(null)} aria-label="Close evidence"><X size={16} /></button></div>
                  <div className="evidence-title"><Link2 size={19} /><h2>{selectedEdge.type === 'explicit_depends_on' ? 'Explicit dependency' : 'Attribute reference'}</h2></div>
                  <div className="edge-route"><button onClick={() => setSelectedNodeId(selectedEdge.source)}>{nodeById.get(selectedEdge.source)?.address || selectedEdge.source}</button><ArrowRight size={15} /><button onClick={() => setSelectedNodeId(selectedEdge.target)}>{nodeById.get(selectedEdge.target)?.address || selectedEdge.target}</button></div>
                  <div className="evidence-intro">This edge was inferred from the Terraform configuration below.</div>
                  {selectedEdge.evidence.map((item, index) => <div className="evidence-card" key={`${item.file}-${item.attribute}-${index}`}><div><FileCode2 size={14} /><strong>{item.file}</strong></div><small>ATTRIBUTE / {item.attribute || 'reference'}</small><code>{item.expression}</code></div>)}
                  <div className="evidence-caveat"><ShieldAlert size={16} /><span>A configuration reference is evidence of a potential dependency, not proof of runtime behavior.</span></div>
                </>
              ) : (
                <div className="inspector-empty"><span className="inspector-empty-mark"><Activity size={19} /></span><span className="eyebrow">OBJECT INSPECTOR</span><h2>Pick a node<br />to inspect.</h2><p>Review its parsed attributes and reference evidence, then trace possible downstream impact.</p><div className="inspector-empty-hint"><span>CLICK</span> a node or edge in the map <ArrowRight size={14} /></div></div>
              )}
            </aside>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;

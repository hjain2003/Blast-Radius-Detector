function walkGraph(startId, edges, direction) {
  const nodes = new Set();
  const edgeIds = new Set();
  const paths = [];
  const queue = [{ id: startId, path: [startId], edgePath: [] }];
  const visited = new Set([startId]);

  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges) {
      const matches = direction === 'downstream'
        ? edge.source === current.id
        : edge.target === current.id;
      if (!matches) continue;

      const nextId = direction === 'downstream' ? edge.target : edge.source;
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      nodes.add(nextId);
      const path = [...current.path, nextId];
      const edgePath = [...current.edgePath, edge.id];
      edgePath.forEach((id) => edgeIds.add(id));
      if (direction === 'downstream') paths.push(path);
      queue.push({ id: nextId, path, edgePath });
    }
  }

  return { nodes, edgeIds, paths };
}

export function traceImpact(nodeId, edges) {
  const downstream = walkGraph(nodeId, edges, 'downstream');
  const upstream = walkGraph(nodeId, edges, 'upstream');
  return {
    affected: downstream.nodes,
    pathEdges: downstream.edgeIds,
    paths: downstream.paths,
    prerequisites: upstream.nodes,
    prerequisiteEdges: upstream.edgeIds,
  };
}
import { render, screen } from '@testing-library/react';
import App from './App';
import { traceImpact } from './impactAnalysis';

test('renders the Terraform archive intake without placeholder infrastructure', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /see what sits downstream/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /upload a terraform zip archive/i })).toBeInTheDocument();
  expect(screen.getByText(/Terraform references suggest possible impact/i)).toBeInTheDocument();
});

test('separates downstream potential impact from upstream prerequisites', () => {
  const edges = [
    { id: 'database-instance', source: 'database', target: 'instance' },
    { id: 'subnet-instance', source: 'subnet', target: 'instance' },
    { id: 'instance-alarm', source: 'instance', target: 'alarm' },
    { id: 'alarm-dashboard', source: 'alarm', target: 'dashboard' },
  ];

  const result = traceImpact('instance', edges);

  expect([...result.affected]).toEqual(['alarm', 'dashboard']);
  expect([...result.prerequisites]).toEqual(['database', 'subnet']);
  expect([...result.pathEdges]).toEqual(['instance-alarm', 'alarm-dashboard']);
  expect([...result.prerequisiteEdges]).toEqual(['database-instance', 'subnet-instance']);
});

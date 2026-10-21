// @vitest-environment happy-dom
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {useState} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {api} from '../api/client';
import {addReference, initialWorkspace, type Workspace} from '../state/workspace';
import {SwapPeople} from './SwapPeople';

vi.mock('../api/client', () => ({api: {upload: vi.fn(), cropBust: vi.fn(), bust: vi.fn(), cancelBust: vi.fn(async () => ({}))},
  fileUrl: (hash: string) => `/api/files/${hash}`}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

const photo = (name: string) => ({hash: name.padEnd(64, '0'), width: 640, height: 480, name});

function Harness({start}: {start: Workspace}) {
  const [ws, setWs] = useState(start);
  return <>
    <SwapPeople workspace={ws} update={next => setWs(typeof next === 'function' ? next : () => next)} notify={vi.fn()}
                detection={{hash: photo('a').hash, status: 'done', count: 2, people: [
                  {x: 0.2, y: 0.2, width: 0.1, height: 0.12}, {x: 0.6, y: 0.2, width: 0.1, height: 0.12}]}} />
    <output data-testid="swaps">{JSON.stringify(ws.request.swaps ?? [])}</output>
  </>;
}

const scene = () => {
  const ws = addReference(initialWorkspace('edit'), 'cena', photo('a'));
  ws.request.participants.existing = 2;
  return ws;
};

it('swaps the person on the right for the crop of a chosen photo and warns about a turned face', async () => {
  vi.mocked(api.upload).mockResolvedValue({hash: 'b'.padEnd(64, '0'), mime: 'image/png', width: 400, height: 600});
  vi.mocked(api.cropBust).mockResolvedValue({id: 'j1', status: 'completed', hash: 'c'.padEnd(64, '0'), width: 512,
    height: 600, turn: 62, frontal: false, faces: 1});
  render(<Harness start={scene()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Abrir'}));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('à direita')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Escolher a foto da Pessoa 2 (à direita)'),
    {target: {files: [new File(['x'], 'bruno.png', {type: 'image/png'})]}});
  await waitFor(() => expect(screen.getByTestId('swaps').textContent).toContain('"position":2'));
  expect(api.cropBust).toHaveBeenCalledWith('b'.padEnd(64, '0'));
  expect(screen.getByText(/O rosto está virado 62°/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Corpo da Pessoa 2 (à direita), em inglês'), {target: {value: 'athletic build'}});
  expect(screen.getByTestId('swaps').textContent).toContain('athletic build');
  fireEvent.click(screen.getByRole('button', {name: 'Manter a original'}));
  expect(screen.getByTestId('swaps').textContent).toBe('[]');
});

it('asks for the number of people before offering the swaps', () => {
  const ws = scene();
  ws.request.participants.existing = null;
  render(<Harness start={ws} />);
  fireEvent.click(screen.getByRole('button', {name: 'Abrir'}));
  expect(screen.getByText(/Informe quantas pessoas há na foto/)).toBeTruthy();
});

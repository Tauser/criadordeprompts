import {Icon} from './Icon';

export function CollapseButton({collapsed, onToggle, controls, label}: {collapsed: boolean; onToggle: () => void; controls: string; label: string}) {
  return (
    <button type="button" className={'collapse-btn' + (collapsed ? ' collapsed' : '')} onClick={onToggle}
            aria-expanded={!collapsed} aria-controls={controls} aria-label={(collapsed ? 'Mostrar ' : 'Recolher ') + label}
            title={collapsed ? 'Mostrar' : 'Recolher'}>
      <Icon name="chevron" size={16} />
    </button>
  );
}

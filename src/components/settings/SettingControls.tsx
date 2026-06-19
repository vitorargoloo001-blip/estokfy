import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

interface SettingSwitchProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}

export function SettingSwitch({ label, checked, onChange, tooltip }: SettingSwitchProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm cursor-pointer">{label}</Label>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[250px]"><p className="text-xs">{tooltip}</p></TooltipContent>
          </Tooltip>
        )}
      </div>
      <Switch checked={!!checked} onCheckedChange={onChange} />
    </div>
  );
}

interface SettingInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  tooltip?: string;
  mask?: (v: string) => string;
  error?: string;
}

export function SettingInput({ label, value, onChange, placeholder, type, tooltip, mask, error }: SettingInputProps) {
  const handleChange = (raw: string) => {
    onChange(mask ? mask(raw) : raw);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[250px]"><p className="text-xs">{tooltip}</p></TooltipContent>
          </Tooltip>
        )}
      </div>
      <Input
        type={type || 'text'}
        value={value || ''}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        className={error ? 'border-destructive' : ''}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface SettingSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  tooltip?: string;
}

export function SettingSelect({ label, value, onChange, options, tooltip }: SettingSelectProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[250px]"><p className="text-xs">{tooltip}</p></TooltipContent>
          </Tooltip>
        )}
      </div>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  value: string | null;
  onChange: (profileId: string | null, name: string | null) => void;
  className?: string;
}

interface Employee {
  profile_id: string;
  auth_user_id: string;
  full_name: string | null;
  role: string;
}

export default function EmployeeFilter({ value, onChange, className }: Props) {
  const [list, setList] = useState<Employee[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_employees');
      setList((data || []) as Employee[]);
    })();
  }, []);

  const handleChange = (v: string) => {
    if (v === 'all') { onChange(null, null); return; }
    const emp = list.find(e => e.profile_id === v);
    onChange(v, emp?.full_name ?? null);
  };

  return (
    <Select value={value ?? 'all'} onValueChange={handleChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Funcionário" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os funcionários</SelectItem>
        {list.map((e) => (
          <SelectItem key={e.profile_id} value={e.profile_id}>
            {e.full_name || '—'} <span className="text-xs text-muted-foreground">({e.role})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  value: string | null;
  onChange: (authUserId: string | null) => void;
  className?: string;
}

interface Employee {
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

  return (
    <Select value={value ?? 'all'} onValueChange={(v) => onChange(v === 'all' ? null : v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Funcionário" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos os funcionários</SelectItem>
        {list.map((e) => (
          <SelectItem key={e.auth_user_id} value={e.auth_user_id}>
            {e.full_name || '—'} <span className="text-xs text-muted-foreground">({e.role})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

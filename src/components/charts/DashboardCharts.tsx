import { lazy, Suspense, memo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(var(--primary-dark))',
  'hsl(var(--accent-light))',
  'hsl(var(--accent-hover))',
  'hsl(221 83% 70%)',
];

interface BarProps { data: { day: string; total: number }[] }
function DailySalesBarImpl({ data }: BarProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" width={50} />
        <Tooltip
          formatter={(v: number) => fmt(v)}
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12, borderRadius: 8 }}
          cursor={{ fill: 'hsl(var(--accent) / 0.08)' }}
        />
        <defs>
          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0.85} />
          </linearGradient>
        </defs>
        <Bar dataKey="total" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
export const DailySalesBar = memo(DailySalesBarImpl);

interface PieProps { data: { name: string; profit: number }[] }
function ProfitPieImpl({ data }: PieProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          dataKey="profit"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }) => `${name.slice(0, 10)} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip
          formatter={(v: number) => fmt(v)}
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
export const ProfitPie = memo(ProfitPieImpl);

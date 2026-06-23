export type BusinessType =
  | 'technical_assistance'
  | 'retail'
  | 'distributor'
  | 'services'
  | 'fashion'
  | 'food'
  | 'auto_parts'
  | 'pet_shop'
  | 'market'
  | 'optical'
  | 'stationery'
  | 'custom';

export interface BusinessLabels {
  product: string;
  products: string;
  service: string;
  order: string;
  sale: string;
  customer: string;
  technician: string;
  employee: string;
  return: string;
  exchange: string;
  inventory: string;
  financial: string;
  report: string;
  work_order: string;
  equipment: string;
  defect: string;
  warranty: string;
  os_title: string;
  os_subtitle: string;
  responsible: string;
  pdf_document: string;
  items_sold: string;
  // conditional fields
  show_imei: boolean;
  show_size_color: boolean;
  show_table_seat: boolean;
  show_vehicle: boolean;
}

export interface BusinessProfile {
  type: BusinessType;
  name: string;
  description: string;
  labels: BusinessLabels;
}

const DEFAULT_LABELS: BusinessLabels = {
  product: 'Produto',
  products: 'Produtos',
  service: 'Serviço',
  order: 'Pedido',
  sale: 'Venda',
  customer: 'Cliente',
  technician: 'Responsável',
  employee: 'Funcionário',
  return: 'Devolução',
  exchange: 'Troca',
  inventory: 'Estoque',
  financial: 'Financeiro',
  report: 'Relatório',
  work_order: 'Ordem de Serviço',
  equipment: 'Item',
  defect: 'Solicitação',
  warranty: 'Garantia',
  os_title: 'Solicitação',
  os_subtitle: 'Detalhes do item',
  responsible: 'Responsável',
  pdf_document: 'Comprovante de Atendimento',
  items_sold: 'itens vendidos',
  show_imei: false,
  show_size_color: false,
  show_table_seat: false,
  show_vehicle: false,
};

export const BUSINESS_PROFILES: Record<BusinessType, BusinessProfile> = {
  technical_assistance: {
    type: 'technical_assistance',
    name: 'Assistência Técnica',
    description: 'Reparo e manutenção de equipamentos eletrônicos',
    labels: {
      ...DEFAULT_LABELS,
      product: 'Peça',
      products: 'Peças',
      service: 'Serviço Técnico',
      order: 'Ordem de Serviço',
      work_order: 'Ordem de Serviço',
      equipment: 'Equipamento',
      defect: 'Defeito relatado',
      os_title: 'Equipamento',
      os_subtitle: 'Dados do equipamento',
      responsible: 'Técnico',
      technician: 'Técnico',
      pdf_document: 'Ordem de Serviço',
      items_sold: 'peças vendidas',
      show_imei: true,
    },
  },

  retail: {
    type: 'retail',
    name: 'Varejo',
    description: 'Loja de varejo geral',
    labels: {
      ...DEFAULT_LABELS,
      work_order: 'Atendimento',
      equipment: 'Produto',
      defect: 'Solicitação',
      os_title: 'Produto',
      os_subtitle: 'Detalhes do produto',
      responsible: 'Atendente',
      pdf_document: 'Comprovante de Venda',
    },
  },

  distributor: {
    type: 'distributor',
    name: 'Distribuidora',
    description: 'Distribuição e vendas no atacado',
    labels: {
      ...DEFAULT_LABELS,
      service: 'Pedido',
      order: 'Pedido',
      work_order: 'Pedido',
      equipment: 'Produto',
      defect: 'Ocorrência',
      responsible: 'Representante',
      technician: 'Representante',
      os_title: 'Produto',
      os_subtitle: 'Detalhes do pedido',
      pdf_document: 'Pedido / Romaneio',
    },
  },

  services: {
    type: 'services',
    name: 'Serviços',
    description: 'Prestação de serviços em geral',
    labels: {
      ...DEFAULT_LABELS,
      product: 'Serviço',
      products: 'Serviços',
      service: 'Serviço',
      work_order: 'Ordem de Serviço',
      equipment: 'Item',
      defect: 'Solicitação',
      os_title: 'Serviço',
      os_subtitle: 'Detalhes da solicitação',
      responsible: 'Responsável',
      technician: 'Responsável',
      pdf_document: 'Comprovante de Atendimento',
      items_sold: 'serviços realizados',
    },
  },

  fashion: {
    type: 'fashion',
    name: 'Moda',
    description: 'Loja de roupas, calçados e acessórios',
    labels: {
      ...DEFAULT_LABELS,
      work_order: 'Atendimento',
      equipment: 'Peça',
      defect: 'Ocorrência',
      responsible: 'Atendente',
      pdf_document: 'Comprovante de Venda',
      items_sold: 'peças vendidas',
      show_size_color: true,
    },
  },

  food: {
    type: 'food',
    name: 'Alimentação',
    description: 'Restaurante, lanchonete ou delivery',
    labels: {
      ...DEFAULT_LABELS,
      product: 'Item',
      products: 'Cardápio',
      service: 'Pedido',
      order: 'Pedido',
      work_order: 'Pedido',
      equipment: 'Item',
      defect: 'Ocorrência',
      os_title: 'Pedido',
      os_subtitle: 'Detalhes do pedido',
      responsible: 'Responsável',
      pdf_document: 'Comprovante de Pedido',
      show_table_seat: true,
    },
  },

  auto_parts: {
    type: 'auto_parts',
    name: 'Autopeças',
    description: 'Peças e acessórios automotivos',
    labels: {
      ...DEFAULT_LABELS,
      product: 'Peça',
      products: 'Peças',
      service: 'Serviço',
      work_order: 'Ordem de Serviço',
      equipment: 'Veículo',
      defect: 'Problema',
      os_title: 'Veículo',
      os_subtitle: 'Dados do veículo',
      responsible: 'Mecânico',
      technician: 'Mecânico',
      pdf_document: 'Ordem de Serviço',
      items_sold: 'peças vendidas',
      show_vehicle: true,
    },
  },

  pet_shop: {
    type: 'pet_shop',
    name: 'Pet Shop',
    description: 'Loja e serviços para animais de estimação',
    labels: {
      ...DEFAULT_LABELS,
      service: 'Serviço',
      work_order: 'Atendimento',
      equipment: 'Animal',
      defect: 'Solicitação',
      os_title: 'Animal',
      os_subtitle: 'Dados do animal',
      responsible: 'Responsável',
      pdf_document: 'Comprovante de Atendimento',
    },
  },

  market: {
    type: 'market',
    name: 'Mercado / Supermercado',
    description: 'Mercado, minimercado ou supermercado',
    labels: {
      ...DEFAULT_LABELS,
      work_order: 'Atendimento',
      equipment: 'Produto',
      defect: 'Ocorrência',
      responsible: 'Atendente',
      pdf_document: 'Comprovante de Venda',
    },
  },

  optical: {
    type: 'optical',
    name: 'Ótica',
    description: 'Ótica e produtos ópticos',
    labels: {
      ...DEFAULT_LABELS,
      service: 'Serviço',
      work_order: 'Ordem de Serviço',
      equipment: 'Produto / Armação',
      defect: 'Solicitação',
      os_title: 'Produto',
      os_subtitle: 'Detalhes do produto',
      responsible: 'Atendente',
      pdf_document: 'Comprovante de Serviço',
    },
  },

  stationery: {
    type: 'stationery',
    name: 'Papelaria',
    description: 'Papelaria, impressão e suprimentos',
    labels: {
      ...DEFAULT_LABELS,
      work_order: 'Atendimento',
      equipment: 'Produto',
      defect: 'Solicitação',
      responsible: 'Atendente',
      pdf_document: 'Comprovante de Venda',
    },
  },

  custom: {
    type: 'custom',
    name: 'Personalizado',
    description: 'Tipo de negócio personalizado',
    labels: { ...DEFAULT_LABELS },
  },
};

export function getBusinessProfile(type?: BusinessType | null): BusinessProfile {
  return BUSINESS_PROFILES[type ?? 'retail'] ?? BUSINESS_PROFILES.retail;
}

export function getBusinessLabel(
  type: BusinessType | null | undefined,
  key: keyof BusinessLabels,
): string | boolean {
  return getBusinessProfile(type).labels[key];
}

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'technical_assistance', label: 'Assistência Técnica' },
  { value: 'retail',               label: 'Varejo' },
  { value: 'distributor',          label: 'Distribuidora' },
  { value: 'services',             label: 'Serviços' },
  { value: 'fashion',              label: 'Moda' },
  { value: 'food',                 label: 'Alimentação' },
  { value: 'auto_parts',           label: 'Autopeças' },
  { value: 'pet_shop',             label: 'Pet Shop' },
  { value: 'market',               label: 'Mercado' },
  { value: 'optical',              label: 'Ótica' },
  { value: 'stationery',           label: 'Papelaria' },
  { value: 'custom',               label: 'Personalizado' },
];

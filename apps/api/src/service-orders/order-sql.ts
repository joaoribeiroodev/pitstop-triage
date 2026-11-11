/** SELECT base do resumo de OS, compartilhado por listagens de vários módulos. */
export const ORDER_SUMMARY_SQL = `
  select o.id, o.order_number, o.status, o.customer_id, c.name as customer_name,
         o.vehicle_id, v.plate as vehicle_plate,
         trim(concat_ws(' ', v.brand, v.model, v.year::text)) as vehicle_label,
         o.assigned_mechanic_id, m.full_name as assigned_mechanic_name,
         o.total_amount, o.opened_at, o.updated_at
    from public.service_orders o
    join public.customers c on c.id = o.customer_id
    join public.vehicles v on v.id = o.vehicle_id
    left join public.tenant_users m on m.id = o.assigned_mechanic_id`;

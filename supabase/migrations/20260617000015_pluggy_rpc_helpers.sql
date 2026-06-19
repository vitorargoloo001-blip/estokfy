-- Pluggy RPC Helper Functions

-- RPC: Update or Insert Bank Connection (helper for OAuth)
CREATE OR REPLACE FUNCTION update_or_insert_bank_connection(
  p_store_id UUID,
  p_provider TEXT,
  p_provider_connection_id TEXT,
  p_access_token_encrypted TEXT,
  p_token_expires_at TIMESTAMP WITH TIME ZONE,
  p_sync_status TEXT,
  p_bank_name TEXT,
  p_account_type TEXT,
  p_status TEXT
) RETURNS UUID AS $$
DECLARE
  v_bank_connection_id UUID;
BEGIN
  INSERT INTO bank_connections (
    store_id,
    provider,
    provider_connection_id,
    access_token_encrypted,
    token_expires_at,
    sync_status,
    bank_name,
    account_type,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_store_id,
    p_provider,
    p_provider_connection_id,
    p_access_token_encrypted,
    p_token_expires_at,
    p_sync_status,
    p_bank_name,
    p_account_type,
    p_status,
    now(),
    now()
  ) ON CONFLICT (provider_connection_id) DO UPDATE
  SET
    access_token_encrypted = p_access_token_encrypted,
    token_expires_at = p_token_expires_at,
    sync_status = p_sync_status,
    updated_at = now()
  RETURNING id INTO v_bank_connection_id;

  RETURN v_bank_connection_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Get decrypted access token for Pluggy API calls
CREATE OR REPLACE FUNCTION get_bank_connection_token(
  p_bank_connection_id UUID,
  p_store_id UUID
) RETURNS TABLE (
  access_token TEXT,
  provider TEXT,
  provider_connection_id TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  needs_refresh BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    convert_from(decode(bc.access_token_encrypted, 'base64'), 'utf-8') as access_token,
    bc.provider,
    bc.provider_connection_id,
    bc.token_expires_at,
    (bc.token_expires_at < now() + INTERVAL '5 minutes') as needs_refresh
  FROM bank_connections bc
  WHERE bc.id = p_bank_connection_id
    AND bc.store_id = p_store_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Sync bank accounts from Pluggy
CREATE OR REPLACE FUNCTION sync_bank_accounts_from_provider(
  p_store_id UUID,
  p_bank_connection_id UUID,
  p_accounts JSONB
) RETURNS TABLE (
  success BOOLEAN,
  accounts_synced INT,
  message TEXT
) AS $$
DECLARE
  v_account_count INT := 0;
  v_account JSONB;
BEGIN
  -- Mark sync as in progress
  UPDATE bank_connections
  SET sync_status = 'syncing'
  WHERE id = p_bank_connection_id;

  -- Insert or update each account
  FOR v_account IN SELECT * FROM jsonb_array_elements(p_accounts)
  LOOP
    INSERT INTO bank_accounts (
      bank_connection_id,
      store_id,
      provider_account_id,
      account_number,
      account_type,
      balance,
      currency,
      status,
      last_sync_at,
      metadata
    ) VALUES (
      p_bank_connection_id,
      p_store_id,
      v_account->>'id',
      v_account->>'accountNumber',
      v_account->>'type',
      (v_account->'balance'->>'amount')::DECIMAL,
      v_account->'balance'->>'currency',
      'active',
      now(),
      v_account
    ) ON CONFLICT (provider_account_id) DO UPDATE
    SET
      balance = (v_account->'balance'->>'amount')::DECIMAL,
      last_sync_at = now(),
      metadata = v_account;

    v_account_count := v_account_count + 1;
  END LOOP;

  -- Mark sync as complete
  UPDATE bank_connections
  SET sync_status = 'synced', last_sync_at = now()
  WHERE id = p_bank_connection_id;

  RETURN QUERY SELECT true, v_account_count, format('Synced %s accounts', v_account_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Sync bank transactions from Pluggy
CREATE OR REPLACE FUNCTION sync_bank_transactions_from_provider(
  p_store_id UUID,
  p_bank_connection_id UUID,
  p_bank_account_id UUID,
  p_transactions JSONB
) RETURNS TABLE (
  success BOOLEAN,
  transactions_synced INT,
  message TEXT
) AS $$
DECLARE
  v_transaction_count INT := 0;
  v_transaction JSONB;
  v_transaction_hash TEXT;
BEGIN
  -- Process each transaction
  FOR v_transaction IN SELECT * FROM jsonb_array_elements(p_transactions)
  LOOP
    -- Create hash for deduplication (date + amount + description)
    v_transaction_hash := md5(
      (v_transaction->>'date') || '|' ||
      (v_transaction->>'amount') || '|' ||
      (v_transaction->>'description')
    );

    INSERT INTO bank_transactions (
      bank_account_id,
      store_id,
      transaction_date,
      amount,
      transaction_type,
      description,
      bank_reference_id,
      status,
      hash_key,
      metadata,
      created_at
    ) VALUES (
      p_bank_account_id,
      p_store_id,
      (v_transaction->>'date')::DATE,
      (v_transaction->>'amount')::DECIMAL,
      v_transaction->>'type',
      v_transaction->>'description',
      v_transaction->>'id',
      'pending',
      v_transaction_hash,
      v_transaction,
      now()
    ) ON CONFLICT (bank_reference_id) DO NOTHING;

    v_transaction_count := v_transaction_count + 1;
  END LOOP;

  RETURN QUERY SELECT true, v_transaction_count, format('Synced %s transactions', v_transaction_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_or_insert_bank_connection TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_bank_connection_token TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_bank_accounts_from_provider TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_bank_transactions_from_provider TO authenticated, service_role;

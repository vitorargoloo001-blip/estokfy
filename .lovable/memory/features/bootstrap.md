---
name: Store Bootstrap
description: Auto-provisioning of new stores via bootstrap_new_store RPC - creates store, owner profile, 12 categories, cash ledger, 9 settings blocks, audit log. Idempotent. Onboarding wizard on first login.
type: feature
---
- RPC `bootstrap_new_store(p_auth_user_id, p_store_name, p_full_name)` creates all seed data
- Called automatically from AuthContext when user has no profile
- Idempotent: returns existing store_id if profile exists
- Creates: store, owner profile, cash_ledger, 12 categories, 9 store_settings blocks
- OnboardingWizard component shown on first login (dismissable, stored in localStorage)
- AuthContext exposes: bootstrapping, needsOnboarding, dismissOnboarding

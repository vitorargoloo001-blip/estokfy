import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";

interface MasterUserInfo {
  isMaster: boolean;
  loading: boolean;
  email: string | null;
}

export function useMasterUser(): MasterUserInfo {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const isMaster = user?.email === "vitorargoloo001@gmail.com";

  useEffect(() => {
    setLoading(false);
  }, [user]);

  return {
    isMaster,
    loading,
    email: user?.email || null,
  };
}

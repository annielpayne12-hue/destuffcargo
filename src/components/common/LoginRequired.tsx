import { useNavigate } from 'react-router-dom';
import { Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LoginRequiredProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function LoginRequired({ title, description, children }: LoginRequiredProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
      <div className="flex flex-col items-center justify-center gap-4 py-16 border border-border rounded-lg bg-muted/20">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <div className="text-center space-y-2">
          <h3 className="text-base font-medium">Login Required</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            This section contains confidential cargo data. Please sign in to view details.
          </p>
        </div>
        <Button onClick={() => navigate('/login')} className="gap-2">
          <LogIn className="h-4 w-4" />
          Sign In
        </Button>
      </div>
    </div>
  );
}

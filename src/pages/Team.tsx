import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import MembersPanel from '@/components/team/MembersPanel';
import InvitationsPanel from '@/components/team/InvitationsPanel';
import PodsPanel from '@/components/team/PodsPanel';

type TabKey = 'members' | 'invitations' | 'pods';

const Team: React.FC = () => {
  const { role, workspace } = useAuth();
  const canInvite = can(role, 'users:invite');
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested === 'pods' || (requested === 'invitations' && canInvite) ? requested : 'members';

  useEffect(() => {
    document.title = 'Team · TBB Workspace';
  }, []);

  return (
    <div className="space-y-4">
      <header className="space-y-1 pt-1">
        <h1 className="page-title">Team</h1>
        <p className="page-description">People, roles and creative pods in {workspace?.name}.</p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'members' ? {} : { tab: v }, { replace: true })}>
        <TabsList className="h-auto rounded-full bg-muted p-0.5">
          <TabsTrigger value="members" className="pill-item h-7 rounded-full px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-soft">
            Members
          </TabsTrigger>
          {canInvite && (
            <TabsTrigger value="invitations" className="pill-item h-7 rounded-full px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-soft">
              Invitations
            </TabsTrigger>
          )}
          <TabsTrigger value="pods" className="pill-item h-7 rounded-full px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-soft">
            Pods
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <MembersPanel />
        </TabsContent>
        {canInvite && (
          <TabsContent value="invitations" className="mt-4">
            <InvitationsPanel />
          </TabsContent>
        )}
        <TabsContent value="pods" className="mt-4">
          <PodsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Team;

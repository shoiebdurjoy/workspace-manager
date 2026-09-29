import React, { useState } from "react";
import {
  Sparkles,
  Search,
  Plus,
  Play,
  CheckCircle2,
  Trash2,
  Copy,
  Download,
  AlertTriangle,
  FolderOpen,
  Filter,
  Check,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, type TBBStatusType } from "@/components/ui/status-badge";
import { PriorityBadge, type TBBPriority } from "@/components/ui/priority-badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { toast } from "sonner";

export const DesignSystemShowcase: React.FC = () => {
  const [activeTab, setActiveTab] = useState("primitives");
  const [inputVal, setInputVal] = useState("");
  const [selectedRole, setSelectedRole] = useState("editor");

  const statuses: TBBStatusType[] = [
    "OPEN",
    "IN_PROGRESS",
    "IN_EDIT",
    "QC_REVIEW",
    "QC_REVISION_NEEDED",
    "READY_TO_DELIVER",
    "DELIVERED",
  ];

  const priorities: TBBPriority[] = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"];

  return (
    <div className="space-y-8 pb-16">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-600 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
              TBB Workspace V2
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Design System &amp; UI Primitives
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A comprehensive catalog of design tokens, interactive components, status badges,
            and layout primitives engineered specifically for Think Big Brand video production teams.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              toast.success("Design System Toast verified", {
                description: "TBB toast notifications are fully functional.",
              })
            }
            className="h-8 gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Trigger Test Toast
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 max-w-xl h-9">
          <TabsTrigger value="primitives" className="text-xs">
            UI Primitives
          </TabsTrigger>
          <TabsTrigger value="badges" className="text-xs">
            Status &amp; Priority
          </TabsTrigger>
          <TabsTrigger value="overlays" className="text-xs">
            Dialogs &amp; Drawers
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-xs">
            States &amp; Feedback
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: UI PRIMITIVES */}
        <TabsContent value="primitives" className="space-y-6 mt-6">
          {/* Buttons Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Button &amp; IconButton Primitives
              </CardTitle>
              <CardDescription className="text-xs">
                Supports standard variants, sizes, icon-only buttons with mandatory accessibility labels and tooltips.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Variants</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">Default</Button>
                  <Button size="sm" variant="secondary">
                    Secondary
                  </Button>
                  <Button size="sm" variant="outline">
                    Outline
                  </Button>
                  <Button size="sm" variant="ghost">
                    Ghost
                  </Button>
                  <Button size="sm" variant="destructive">
                    Destructive
                  </Button>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-[#7B2CBF] to-[#7B68EE] text-white hover:opacity-90"
                  >
                    TBB Brand
                  </Button>
                  <Button size="sm" disabled>
                    Disabled
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Accessible IconButtons (with Tooltips &amp; ARIA)
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <IconButton
                    aria-label="Add task"
                    tooltip="Add Task"
                    icon={<Plus className="h-4 w-4" />}
                    size="sm"
                    variant="outline"
                  />
                  <IconButton
                    aria-label="Search"
                    tooltip="Search"
                    icon={<Search className="h-4 w-4" />}
                    size="sm"
                    variant="ghost"
                  />
                  <IconButton
                    aria-label="Copy link"
                    tooltip="Copy link to clipboard"
                    icon={<Copy className="h-4 w-4" />}
                    size="sm"
                    variant="secondary"
                  />
                  <IconButton
                    aria-label="Delete deliverable"
                    tooltip="Delete deliverable"
                    icon={<Trash2 className="h-4 w-4" />}
                    size="sm"
                    variant="destructive"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Form Inputs Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Form Inputs &amp; Selects</CardTitle>
              <CardDescription className="text-xs">
                Accessible inputs, textareas, and Radix selects with responsive layout.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Task Title</label>
                <Input
                  placeholder="e.g. 25. EDAPTX - Tech Review Video Edit"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Assigned Role</label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor (Video Cutter)</SelectItem>
                    <SelectItem value="qc">QC Specialist (Reviewer)</SelectItem>
                    <SelectItem value="manager">Production Manager</SelectItem>
                    <SelectItem value="author">Admin (Owner)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-foreground">Editor Notes &amp; Frame.io URL</label>
                <Textarea
                  placeholder="Add specific client revisions, timecodes, or raw footage drive paths..."
                  rows={3}
                  className="text-xs"
                />
              </div>
            </CardContent>
          </Card>

          {/* Table Primitive Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Table / List Primitive</CardTitle>
              <CardDescription className="text-xs">
                ClickUp-style list table showing deliverables, assigned editors, statuses, and due dates.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center text-xs">#</TableHead>
                    <TableHead className="text-xs">Deliverable Name</TableHead>
                    <TableHead className="text-xs">Editor</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Priority</TableHead>
                    <TableHead className="text-right text-xs pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">01</TableCell>
                    <TableCell className="text-xs font-medium flex items-center gap-2">
                      <Video className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                      <span>EDAPTX - Smartphone Camera Deep Dive</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name="Alex Rivera" size="xs" status="online" />
                        <span className="text-xs">Alex R.</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status="IN_EDIT" />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority="HIGH" />
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <IconButton
                        aria-label="Options"
                        tooltip="Actions"
                        icon={<Play className="h-3 w-3" />}
                        size="xs"
                        variant="ghost"
                      />
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">02</TableCell>
                    <TableCell className="text-xs font-medium flex items-center gap-2">
                      <Video className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                      <span>KRAV - 10-Minute Morning Routine</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name="Elena Rostova" size="xs" status="busy" />
                        <span className="text-xs">Elena R.</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status="QC_REVIEW" />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority="URGENT" />
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <IconButton
                        aria-label="Options"
                        tooltip="Actions"
                        icon={<Play className="h-3 w-3" />}
                        size="xs"
                        variant="ghost"
                      />
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell className="text-center font-mono text-xs text-muted-foreground">03</TableCell>
                    <TableCell className="text-xs font-medium flex items-center gap-2">
                      <Video className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                      <span>Viral Hook Reel #14 - Final Cut</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name="Marcus Chen" size="xs" status="online" />
                        <span className="text-xs">Marcus C.</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status="READY_TO_DELIVER" />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority="NORMAL" />
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <IconButton
                        aria-label="Options"
                        tooltip="Actions"
                        icon={<Play className="h-3 w-3" />}
                        size="xs"
                        variant="ghost"
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: STATUS & PRIORITY BADGES */}
        <TabsContent value="badges" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                TBB Video Production Statuses
              </CardTitle>
              <CardDescription className="text-xs">
                Reflects the real video editing pipeline from raw intake to QC and final delivery.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {statuses.map((s) => (
                  <StatusBadge key={s} status={s} />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">ClickUp Priority Badges</CardTitle>
              <CardDescription className="text-xs">
                Color-coded priority flags with tooltip support for compact views.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Standard Badges</p>
                <div className="flex flex-wrap items-center gap-2">
                  {priorities.map((p) => (
                    <PriorityBadge key={p} priority={p} />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Icon-Only Mode (Hover to view tooltip)
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {priorities.map((p) => (
                    <PriorityBadge key={p} priority={p} iconOnly />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">User Avatars &amp; Roles</CardTitle>
              <CardDescription className="text-xs">
                Avatars with presence indicators (online, offline, busy, away) and role pills.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <UserAvatar name="Sarah Connor" size="lg" status="online" />
                  <div>
                    <p className="text-xs font-semibold">Sarah Connor</p>
                    <p className="text-[10px] text-muted-foreground">QC Specialist • Online</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <UserAvatar name="David Miller" size="md" status="busy" />
                  <div>
                    <p className="text-xs font-semibold">David Miller</p>
                    <p className="text-[10px] text-muted-foreground">Lead Editor • In Render</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <UserAvatar name="Think Big Brand" size="sm" status="online" />
                  <div>
                    <p className="text-xs font-semibold">TBB Admin</p>
                    <p className="text-[10px] text-muted-foreground">Production Manager</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: DIALOGS & OVERLAYS */}
        <TabsContent value="overlays" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Dialogs &amp; Drawers</CardTitle>
              <CardDescription className="text-xs">
                Accessible modal dialogs and slide-over sheets for task details and quick creation.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {/* Modal Dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="text-xs">
                    Open Dialog Preview
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>TBB Production Deliverable</DialogTitle>
                    <DialogDescription className="text-xs">
                      Inspect render settings, frame rate, and client review feedback.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-2 text-xs text-muted-foreground space-y-2">
                    <p>
                      <strong>Resolution:</strong> 4K UHD (3840x2160) @ 59.94 fps
                    </p>
                    <p>
                      <strong>Color Space:</strong> Rec.709 / DaVinci Wide Gamut
                    </p>
                    <p>
                      <strong>Master Audio:</strong> -14 LUFS Integrated Stereo
                    </p>
                  </div>
                  <DialogFooter>
                    <Button
                      size="sm"
                      onClick={() => toast.info("Master deliverable approved")}
                      className="text-xs"
                    >
                      Confirm
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Slide-over Drawer / Sheet */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="sm" variant="secondary" className="text-xs">
                    Open Drawer / Sheet Preview
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-80 sm:w-96">
                  <SheetHeader>
                    <SheetTitle>Task Inspector</SheetTitle>
                    <SheetDescription className="text-xs">
                      Inspect task metadata, assigned editors, and revision logs.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 space-y-4 text-xs">
                    <div>
                      <p className="font-semibold text-foreground">Space / Folder</p>
                      <p className="text-muted-foreground">Client Video Production / 25. EDAPTX</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Current Status</p>
                      <StatusBadge status="IN_EDIT" className="mt-1" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">Priority</p>
                      <PriorityBadge priority="HIGH" className="mt-1" />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: STATES & FEEDBACK */}
        <TabsContent value="feedback" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Empty State */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">EmptyState Component</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<FolderOpen className="h-6 w-6 text-purple-600" />}
                  title="No deliverables found"
                  description="There are currently no video tasks in this list. Create a new task to assign an editor."
                  action={
                    <Button size="sm" className="h-8 text-xs bg-purple-600 text-white">
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Create Task
                    </Button>
                  }
                />
              </CardContent>
            </Card>

            {/* Error State */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">ErrorState Component</CardTitle>
              </CardHeader>
              <CardContent>
                <ErrorState
                  title="Failed to sync workspace list"
                  message="The network connection to the media asset library timed out. Check your VPN or connection."
                  onRetry={() => toast.info("Retrying connection...")}
                />
              </CardContent>
            </Card>

            {/* Loading State Spinner */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">LoadingState (Spinner)</CardTitle>
              </CardHeader>
              <CardContent>
                <LoadingState
                  title="Rendering timeline preview..."
                  description="Generating proxy waveform cache for review."
                />
              </CardContent>
            </Card>

            {/* Loading State Skeleton */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">LoadingState (Skeleton)</CardTitle>
              </CardHeader>
              <CardContent>
                <LoadingState
                  variant="skeleton"
                  title="Loading tasks..."
                  skeletonRows={3}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DesignSystemShowcase;

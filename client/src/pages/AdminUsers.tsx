import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ShieldAlert, Users } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

export default function AdminUsers() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});

  const canManageUsers = user?.role === "admin";

  const usersQuery = trpc.admin.listUsers.useQuery(undefined, {
    enabled: canManageUsers,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const createUserMutation = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      toast.success("User account created.");
      await utils.admin.listUsers.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Unable to create user.");
    },
  });

  const resetPasswordMutation = trpc.admin.resetPassword.useMutation({
    onSuccess: async (_, variables) => {
      setPasswordDrafts(current => ({ ...current, [variables.userId]: "" }));
      toast.success("Password updated.");
      await utils.admin.listUsers.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Unable to reset password.");
    },
  });

  const deactivateUserMutation = trpc.admin.deactivateUser.useMutation({
    onSuccess: async () => {
      toast.success("User deactivated.");
      await utils.admin.listUsers.invalidate();
    },
    onError: error => {
      toast.error(error.message || "Unable to deactivate user.");
    },
  });

  const rows = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await createUserMutation.mutateAsync({
      name,
      email,
      password,
      role,
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Users className="h-5 w-5 text-primary" />
                Create managed account
              </CardTitle>
              <CardDescription>
                End users cannot self-register. Create each account here and share the initial password securely.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateUser}>
                <div className="space-y-2">
                  <Label htmlFor="name">Display name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder="Portfolio User"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Initial password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    value={role}
                    onChange={event => setRole(event.target.value as "user" | "admin")}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button className="w-full" type="submit" disabled={createUserMutation.isPending || !canManageUsers}>
                  {createUserMutation.isPending ? "Creating..." : "Create account"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle>User directory</CardTitle>
              <CardDescription>
                Review account status, reset passwords, and deactivate accounts without affecting each user's watchlist data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!canManageUsers ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/20 px-6 py-10 text-center">
                  <ShieldAlert className="h-8 w-8 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="font-medium">Admin access required</p>
                    <p className="text-sm text-muted-foreground">
                      Only administrator accounts can create or manage other users.
                    </p>
                  </div>
                </div>
              ) : usersQuery.isLoading ? (
                <div className="py-16 text-center text-sm text-muted-foreground">Loading users...</div>
              ) : usersQuery.error ? (
                <div className="py-16 text-center text-sm text-destructive">
                  {usersQuery.error.message || "Unable to load users."}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last sign-in</TableHead>
                        <TableHead className="min-w-[220px]">Reset password</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map(row => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium">{row.name || "-"}</div>
                          </TableCell>
                          <TableCell>{row.email}</TableCell>
                          <TableCell>
                            <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                              {row.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.isActive === 1 ? "secondary" : "outline"}>
                              {row.isActive === 1 ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {row.lastSignedIn ? new Date(row.lastSignedIn).toLocaleString() : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Input
                                type="password"
                                minLength={8}
                                value={passwordDrafts[row.id] ?? ""}
                                onChange={event =>
                                  setPasswordDrafts(current => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                                placeholder="New password"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                disabled={
                                  resetPasswordMutation.isPending ||
                                  !(passwordDrafts[row.id] ?? "").trim()
                                }
                                onClick={() =>
                                  resetPasswordMutation.mutate({
                                    userId: row.id,
                                    password: passwordDrafts[row.id] ?? "",
                                  })
                                }
                              >
                                Save
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={
                                deactivateUserMutation.isPending ||
                                row.isActive !== 1 ||
                                user?.id === row.id
                              }
                              onClick={() => deactivateUserMutation.mutate({ userId: row.id })}
                            >
                              Deactivate
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  createUserSchema,
  type CreateUserInput,
  updateUserSchema,
  USER_ROLES,
} from "@moyasar-ops/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import type { PublicUser } from "@/lib/api/types";
import { can } from "@/lib/auth/permissions";
import { useSession } from "@/lib/auth/use-session";

function CreateUserDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserInput>({ resolver: zodResolver(createUserSchema) });

  const mutation = useMutation({
    mutationFn: (input: CreateUserInput) => api.users.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success("User created");
      setOpen(false);
      reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Create failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add user</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" {...register("displayName")} />
            {errors.displayName ? (
              <p className="text-xs text-destructive">{errors.displayName.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <NativeSelect id="role" {...register("role")}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" {...register("password")} />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user }: { user: PublicUser }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        displayName,
        role,
        isActive,
        ...(password ? { password } : {}),
      };
      const parsed = updateUserSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(
          "validation",
          parsed.error.issues[0]?.message ?? "Invalid input",
          422,
        );
      }
      return api.users.update(user.id, parsed.data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.users });
      toast.success("User updated");
      setOpen(false);
      setPassword("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Update failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="edit-displayName">Display name</Label>
            <Input
              id="edit-displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <NativeSelect
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as PublicUser["role"])}
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              aria-label="active"
            />
            Active
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="edit-password">New password (optional)</Label>
            <Input
              id="edit-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { user, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && user && !can.admin(user)) router.replace("/");
  }, [isLoading, user, router]);

  const { data, isLoading: usersLoading } = useQuery({
    queryKey: qk.users,
    queryFn: () => api.users.list(),
    enabled: can.admin(user),
  });

  const columns = useMemo<ColumnDef<PublicUser, unknown>[]>(
    () => [
      { accessorKey: "email", header: "Email" },
      { accessorKey: "displayName", header: "Name" },
      { accessorKey: "role", header: "Role" },
      {
        accessorKey: "isActive",
        header: "Active",
        cell: ({ row }) => (row.original.isActive ? "Yes" : "No"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => <EditUserDialog user={row.original} />,
      },
    ],
    [],
  );

  if (isLoading || !user || !can.admin(user)) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <CreateUserDialog />
      </div>
      <DataTable
        columns={columns}
        data={data?.users ?? []}
        meta={{ page: 1, perPage: (data?.users ?? []).length || 1, total: (data?.users ?? []).length, totalPages: 1 }}
        onPageChange={() => {}}
        isLoading={usersLoading}
        empty={<span className="text-sm text-muted-foreground">No users.</span>}
      />
    </div>
  );
}

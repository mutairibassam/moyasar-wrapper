"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@moyasar-ops/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.auth.login(values);
      await queryClient.invalidateQueries({ queryKey: qk.me });
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
        toast.error(err.message);
        for (const [field, messages] of Object.entries(err.fieldErrors())) {
          if (field === "email" || field === "password") {
            setError(field, { message: messages[0] });
          }
        }
        return;
      }
      throw err;
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="username" {...register("email")} />
        {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

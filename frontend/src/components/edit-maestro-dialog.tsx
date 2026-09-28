"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  EMPTY_LOCATION,
  LocationPicker,
  type LocationValue,
} from "@/components/location-picker";
import { Reveal } from "@/components/reveal";
import { SchoolPicker, type SchoolValue } from "@/components/school-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { displayPhone } from "@/lib/phone-display";
import { validatePhone } from "@/lib/phone";
import { REGISTRATION_LIMITS } from "@/lib/registration-limits";
import { validateRegistrationText } from "@/lib/registration-text";
import { updateMaestro, type Maestro } from "@/lib/users-api";

type Errors = Partial<
  Record<
    "firstName" | "lastName" | "phone" | "school" | "department" | "city",
    string
  >
>;

export function EditMaestroDialog({
  maestro,
  onClose,
  onSaved,
}: {
  maestro: Maestro | null;
  onClose: () => void;
  onSaved: (maestro: Maestro) => void;
}) {
  return (
    <Dialog
      open={maestro !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
        {maestro && (
          <EditForm
            key={maestro.id}
            maestro={maestro}
            onSaved={(saved) => {
              onSaved(saved);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  maestro,
  onSaved,
}: {
  maestro: Maestro;
  onSaved: (maestro: Maestro) => void;
}) {
  const [firstName, setFirstName] = useState(maestro.firstName ?? "");
  const [lastName, setLastName] = useState(maestro.lastName ?? "");
  const [phone, setPhone] = useState(displayPhone(maestro.phone));
  const [school, setSchool] = useState<SchoolValue>({
    codUe: maestro.isHomeschool ? null : maestro.schoolCodUe,
    name: maestro.isHomeschool
      ? "Educación en casa"
      : (maestro.schoolName ?? ""),
    institutionType: maestro.isHomeschool ? "homeschool" : "school",
  });
  const [manual, setManual] = useState(
    !maestro.isHomeschool &&
      !maestro.schoolCodUe &&
      Boolean(maestro.schoolName),
  );
  const [place, setPlace] = useState<LocationValue>(
    maestro.department
      ? { department: maestro.department, city: maestro.city ?? "" }
      : EMPTY_LOCATION,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const needsLocation =
    !school.codUe && (school.institutionType === "homeschool" || manual);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const first = validateRegistrationText(firstName, "firstName");
    const last = validateRegistrationText(lastName, "lastName");
    const phoneCheck = validatePhone(phone);
    const next: Errors = {
      firstName: first.error,
      lastName: last.error,
      phone: phoneCheck.error,
      school: school.name.trim()
        ? undefined
        : "Indica el colegio o educación en casa.",
      department:
        needsLocation && !place.department
          ? "Elige el departamento."
          : undefined,
      city:
        needsLocation && place.department && !place.city.trim()
          ? "Elige la ciudad."
          : undefined,
    };
    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      const saved = await updateMaestro(maestro.id, {
        firstName: first.value!,
        lastName: last.value!,
        phone: phoneCheck.number!,
        institutionType: school.institutionType,
        schoolCodUe: school.codUe,
        schoolName: school.name.trim(),
        department: needsLocation ? place.department : null,
        city: needsLocation ? place.city.trim() : null,
      });
      toast.success("Datos del maestro actualizados.");
      onSaved(saved);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo guardar.";
      if (error instanceof ApiError && error.field) {
        const field = error.field === "schoolName" ? "school" : error.field;
        setErrors({ [field]: message });
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const clear = (field: keyof Errors) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Editar datos del maestro</DialogTitle>
        <DialogDescription>
          {maestro.email}. El correo no se cambia: es la cuenta con la que
          entra.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.firstName) || undefined}>
            <FieldLabel htmlFor="edit-first">Nombres</FieldLabel>
            <FieldContent>
              <Input
                id="edit-first"
                maxLength={REGISTRATION_LIMITS.firstName}
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  clear("firstName");
                }}
                aria-invalid={Boolean(errors.firstName)}
              />
              <ErrorText message={errors.firstName} />
            </FieldContent>
          </Field>
          <Field data-invalid={Boolean(errors.lastName) || undefined}>
            <FieldLabel htmlFor="edit-last">Apellidos</FieldLabel>
            <FieldContent>
              <Input
                id="edit-last"
                maxLength={REGISTRATION_LIMITS.lastName}
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  clear("lastName");
                }}
                aria-invalid={Boolean(errors.lastName)}
              />
              <ErrorText message={errors.lastName} />
            </FieldContent>
          </Field>
        </div>

        <Field data-invalid={Boolean(errors.phone) || undefined}>
          <FieldLabel htmlFor="edit-phone">Teléfono</FieldLabel>
          <FieldContent>
            <Input
              id="edit-phone"
              type="tel"
              inputMode="tel"
              maxLength={REGISTRATION_LIMITS.phone}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clear("phone");
              }}
              aria-invalid={Boolean(errors.phone)}
            />
            <ErrorText message={errors.phone} />
          </FieldContent>
        </Field>

        <Field data-invalid={Boolean(errors.school) || undefined}>
          <FieldLabel htmlFor="school-search">¿Dónde enseña?</FieldLabel>
          <FieldContent>
            <SchoolPicker
              value={school}
              onChange={(value) => {
                setSchool(value);
                clear("school");
              }}
              onManualChange={setManual}
              invalid={Boolean(errors.school)}
            />
            <ErrorText message={errors.school} />
          </FieldContent>
        </Field>

        {needsLocation && (
          <LocationPicker
            value={place}
            onChange={(value) => {
              setPlace(value);
              clear("department");
              clear("city");
            }}
            departmentError={errors.department}
            cityError={errors.city}
          />
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={saving}>
            Cancelar
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ErrorText({ message }: { message?: string }) {
  return (
    <Reveal className="-mt-1" message={message}>
      {(text) => (
        <p role="alert" className="text-sm text-destructive">
          {text}
        </p>
      )}
    </Reveal>
  );
}

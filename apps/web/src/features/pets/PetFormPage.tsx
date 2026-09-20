import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PET_SEXES,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  type CreatePetInput,
  createPetSchema,
} from '@pawsitive/shared';
import {
  useCreatePetMutation,
  useGetPetQuery,
  useUpdatePetMutation,
  useUploadPetPhotoMutation,
} from '@/app/api/petApi';
import { errorMessage } from '@/app/api/baseApi';
import { useAppDispatch } from '@/app/hooks';
import { toastSuccess } from '@/app/slices/toastSlice';
import { Button } from '@/design/Button';
import { Card } from '@/design/Card';
import { Checkbox, Input, Select, Textarea } from '@/design/Field';
import { PageHeader, SectionHeader } from '@/design/PageHeader';
import { LoadingPanel } from '@/design/Spinner';
import { TagInput } from '@/design/TagInput';
import { PhotoPicker } from '@/design/PhotoPicker';
import { useZodForm } from '@/lib/useZodForm';

/**
 * Add or edit a pet.
 *
 * One component for both, keyed on the presence of a route param. The
 * alternative — two near-identical pages — drifts: a field added to one is
 * forgotten in the other, and the "add" form ends up missing something the
 * "edit" form has.
 */
export default function PetFormPage() {
  const { petId } = useParams<{ petId: string }>();
  const isEdit = Boolean(petId);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const { data: existing, isLoading: loadingPet } = useGetPetQuery(petId as string, {
    skip: !petId,
  });

  const [createPet, { isLoading: creating }] = useCreatePetMutation();
  const [updatePet, { isLoading: updating }] = useUpdatePetMutation();
  const [uploadPhoto, { isLoading: uploading }] = useUploadPetPhotoMutation();

  /* Held locally until the pet exists — a photo needs an id to attach to, so
     on the create path it is uploaded immediately after the pet is saved. */
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm({
    schema: createPetSchema,
    initialValues: {
      name: existing?.name ?? '',
      species: existing?.species ?? 'dog',
      sex: existing?.sex ?? 'unknown',
      breed: existing?.breed ?? '',
      dateOfBirth: existing?.dateOfBirth ?? '',
      isDateOfBirthApproximate: existing?.isDateOfBirthApproximate ?? false,
      weightKg: existing?.weightKg,
      color: existing?.color ?? '',
      microchipId: existing?.microchipId ?? '',
      allergies: existing?.allergies ?? [],
      chronicConditions: existing?.chronicConditions ?? [],
      currentMedications: existing?.currentMedications ?? [],
      isNeutered: existing?.isNeutered ?? false,
      isInsured: existing?.isInsured ?? false,
      insuranceProvider: existing?.insuranceProvider ?? '',
      insurancePolicyNumber: existing?.insurancePolicyNumber ?? '',
      emergencyNotes: existing?.emergencyNotes ?? '',
    } as unknown as CreatePetInput,

    async onSubmit(values) {
      setFormError(null);

      /**
       * Empty strings are stripped before submit.
       *
       * The schema types these as optional, and `''` is not the same as absent:
       * `microchipId: ''` would be written as an empty string and collide with
       * the next chip-less pet on the unique index. Optional means omitted.
       */
      const payload = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== '' && value !== undefined),
      ) as CreatePetInput;

      try {
        const pet = isEdit
          ? await updatePet({ id: petId as string, body: payload }).unwrap()
          : await createPet(payload).unwrap();

        if (pendingPhoto) {
          /* A failed photo upload must not lose the pet that was just saved,
             so it is awaited separately and its failure reported on its own. */
          try {
            await uploadPhoto({ id: pet.id, file: pendingPhoto }).unwrap();
          } catch {
            dispatch(
              toastSuccess(
                `${pet.name} was saved`,
                'The photo did not upload — you can add it from their profile.',
              ),
            );
            navigate(`/app/pets/${pet.id}`);
            return;
          }
        }

        dispatch(toastSuccess(isEdit ? `${pet.name} updated` : `${pet.name} added`));
        navigate(`/app/pets/${pet.id}`);
      } catch (error) {
        form.applyServerErrors(error);
        setFormError(errorMessage(error));
      }
    },
  });

  if (isEdit && loadingPet) return <LoadingPanel label="Loading pet" />;

  const submitting = creating || updating || uploading || form.submitting;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isEdit ? `Edit ${existing?.name ?? 'pet'}` : 'Add a pet'}
        description={
          isEdit
            ? 'Keep their details current so their clinicians have the full picture.'
            : 'The more you add now, the more useful their medical history becomes later.'
        }
        breadcrumbs={[
          { label: 'My pets', to: '/app/pets' },
          ...(isEdit && existing
            ? [{ label: existing.name, to: `/app/pets/${existing.id}` }, { label: 'Edit' }]
            : [{ label: 'Add' }]),
        ]}
      />

      {formError && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-sm text-danger"
        >
          {formError}
        </div>
      )}

      <form onSubmit={form.handleSubmit} className="space-y-6" noValidate>
        <Card>
          <SectionHeader title="The basics" />

          <div className="space-y-4">
            <div className="flex flex-col gap-5 sm:flex-row">
              <PhotoPicker
                currentUrl={existing?.photo?.url}
                onSelect={setPendingPhoto}
                label={`Photo of ${form.values.name || 'your pet'}`}
              />

              <div className="flex-1 space-y-4">
                <Input
                  name="name"
                  label="Name"
                  required
                  autoFocus
                  placeholder="Bruno"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.handleBlur('name')}
                  error={form.errorFor('name')}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    name="species"
                    label="Species"
                    required
                    value={form.values.species}
                    onChange={(event) =>
                      form.setValue('species', event.target.value as CreatePetInput['species'])
                    }
                    error={form.errorFor('species')}
                    options={PET_SPECIES.map((value) => ({
                      value,
                      label: PET_SPECIES_LABELS[value],
                    }))}
                  />

                  <Select
                    name="sex"
                    label="Sex"
                    value={form.values.sex}
                    onChange={(event) =>
                      form.setValue('sex', event.target.value as CreatePetInput['sex'])
                    }
                    options={PET_SEXES.map((value) => ({
                      value,
                      label: value === 'unknown' ? 'Not known' : value === 'male' ? 'Male' : 'Female',
                    }))}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                name="breed"
                label="Breed"
                placeholder="Labrador Retriever"
                hint="Free text — mixed breeds welcome."
                value={form.values.breed ?? ''}
                onChange={(event) => form.setValue('breed', event.target.value)}
                error={form.errorFor('breed')}
              />

              <Input
                name="color"
                label="Colour or markings"
                placeholder="Golden with a white chest"
                value={form.values.color ?? ''}
                onChange={(event) => form.setValue('color', event.target.value)}
                error={form.errorFor('color')}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Input
                  name="dateOfBirth"
                  type="date"
                  label="Date of birth"
                  /* Explains why we ask for a date rather than an age — which
                     is the question this field always prompts. */
                  hint="We store a birth date so their age is always right."
                  /* Nobody was born tomorrow. */
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.values.dateOfBirth ?? ''}
                  onChange={(event) => form.setValue('dateOfBirth', event.target.value)}
                  onBlur={() => form.handleBlur('dateOfBirth')}
                  error={form.errorFor('dateOfBirth')}
                />

                <div className="mt-2">
                  <Checkbox
                    name="isDateOfBirthApproximate"
                    label="This is an estimate"
                    hint="Common for rescues — we will show their age as approximate."
                    checked={Boolean(form.values.isDateOfBirthApproximate)}
                    onChange={(event) =>
                      form.setValue('isDateOfBirthApproximate', event.target.checked)
                    }
                  />
                </div>
              </div>

              <Input
                name="weightKg"
                type="number"
                step="0.1"
                min="0"
                label="Weight (kg)"
                placeholder="29.4"
                hint="Their clinician will keep this current at each visit."
                value={form.values.weightKg ?? ''}
                onChange={(event) =>
                  form.setValue(
                    'weightKg',
                    event.target.value === '' ? undefined : Number(event.target.value),
                  )
                }
                onBlur={() => form.handleBlur('weightKg')}
                error={form.errorFor('weightKg')}
              />
            </div>

            <Input
              name="microchipId"
              label="Microchip number"
              placeholder="900123456789012"
              hint="Usually 15 digits. Helps reunite them if they go missing."
              value={form.values.microchipId ?? ''}
              onChange={(event) => form.setValue('microchipId', event.target.value)}
              onBlur={() => form.handleBlur('microchipId')}
              error={form.errorFor('microchipId')}
            />
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="Health"
            description="Anything a vet should know before they start an examination."
          />

          <div className="space-y-4">
            <TagInput
              label="Allergies"
              placeholder="Add an allergy and press Enter"
              hint="Foods, medications, environmental — anything that has caused a reaction."
              value={form.values.allergies ?? []}
              onChange={(next) => form.setValue('allergies', next)}
            />

            <TagInput
              label="Ongoing conditions"
              placeholder="Add a condition and press Enter"
              value={form.values.chronicConditions ?? []}
              onChange={(next) => form.setValue('chronicConditions', next)}
            />

            <TagInput
              label="Current medications"
              placeholder="Add a medication and press Enter"
              value={form.values.currentMedications ?? []}
              onChange={(next) => form.setValue('currentMedications', next)}
            />

            <Textarea
              name="emergencyNotes"
              label="Emergency notes"
              placeholder="Reacts badly to sedation. Very nervous around other dogs."
              hint="Shown prominently to any clinician who opens their record."
              maxLength={1000}
              showCount
              value={form.values.emergencyNotes ?? ''}
              onChange={(event) => form.setValue('emergencyNotes', event.target.value)}
              error={form.errorFor('emergencyNotes')}
            />

            <Checkbox
              name="isNeutered"
              label="Neutered or spayed"
              checked={Boolean(form.values.isNeutered)}
              onChange={(event) => form.setValue('isNeutered', event.target.checked)}
            />
          </div>
        </Card>

        <Card>
          <SectionHeader title="Insurance" description="Optional, but useful at claim time." />

          <Checkbox
            name="isInsured"
            label="This pet is insured"
            checked={Boolean(form.values.isInsured)}
            onChange={(event) => form.setValue('isInsured', event.target.checked)}
          />

          {/* The policy fields only appear once insurance is ticked — two
              always-visible inputs that are usually irrelevant make the form
              look longer than it is. */}
          {form.values.isInsured && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                name="insuranceProvider"
                label="Provider"
                value={form.values.insuranceProvider ?? ''}
                onChange={(event) => form.setValue('insuranceProvider', event.target.value)}
                error={form.errorFor('insuranceProvider')}
              />
              <Input
                name="insurancePolicyNumber"
                label="Policy number"
                value={form.values.insurancePolicyNumber ?? ''}
                onChange={(event) => form.setValue('insurancePolicyNumber', event.target.value)}
                error={form.errorFor('insurancePolicyNumber')}
              />
            </div>
          )}
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="lg" loading={submitting}>
            {isEdit ? 'Save changes' : 'Add pet'}
          </Button>
        </div>
      </form>
    </div>
  );
}

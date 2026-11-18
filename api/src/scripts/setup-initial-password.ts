import { confirm, password, select } from '@inquirer/prompts';
import argon2 from 'argon2';

import { db } from '../db.js';
import { ARGON2_OPTIONS } from '../modules/auth/auth.constants.js';

interface PendingUser {
  id: string;
  display_name: string;
  email: string;
}

async function configurePassword(user: PendingUser): Promise<void> {
  const firstPassword = await password({
    message: `Nueva contraseña para ${user.display_name} (${user.email}):`,
    validate: (value) => {
      if (value.length < 8) {
        return 'La contraseña debe tener al menos 8 caracteres.';
      }

      if (value.length > 128) {
        return 'La contraseña no puede superar los 128 caracteres.';
      }

      if (value.trim().length === 0) {
        return 'La contraseña no puede estar vacía.';
      }

      return true;
    },
  });

  const confirmation = await password({
    message: 'Repetí la contraseña:',
  });

  if (firstPassword !== confirmation) {
    throw new Error('Las contraseñas no coinciden. No se realizaron cambios.');
  }

  const passwordHash = await argon2.hash(firstPassword, ARGON2_OPTIONS);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query<{
      id: string;
      is_active: boolean;
      password_hash: string | null;
    }>(
      `
        SELECT id, is_active, password_hash
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [user.id],
    );

    const currentUser = currentResult.rows[0];

    if (!currentUser || !currentUser.is_active) {
      throw new Error('El usuario no existe o está inactivo.');
    }

    if (currentUser.password_hash !== null) {
      throw new Error(
        'El usuario ya tiene una contraseña configurada. No se modificó.',
      );
    }

    const updateResult = await client.query(
      `
        UPDATE users
        SET password_hash = $1
        WHERE id = $2
          AND password_hash IS NULL
      `,
      [passwordHash, user.id],
    );

    if (updateResult.rowCount !== 1) {
      throw new Error('No se pudo configurar la contraseña.');
    }

    await client.query('COMMIT');

    console.log(
      `Contraseña configurada correctamente para ${user.display_name}.`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log('\n=== Configuración inicial de contraseñas ===\n');

  while (true) {
    const result = await db.query<PendingUser>(
      `
        SELECT id, display_name, email
        FROM users
        WHERE is_active = TRUE
          AND password_hash IS NULL
        ORDER BY display_name
      `,
    );

    const pendingUsers = result.rows;

    if (pendingUsers.length === 0) {
      console.log('Todos los usuarios activos tienen contraseña configurada.');
      break;
    }

    console.log(`Usuarios pendientes: ${pendingUsers.length}`);

    const selectedUserId = await select({
      message: 'Seleccioná el usuario que vas a configurar:',
      choices: pendingUsers.map((user) => ({
        name: `${user.display_name} (${user.email})`,
        value: user.id,
      })),
    });

    const selectedUser = pendingUsers.find(
      (user) => user.id === selectedUserId,
    );

    if (!selectedUser) {
      throw new Error('No se pudo identificar el usuario seleccionado.');
    }

    await configurePassword(selectedUser);

    const remainingResult = await db.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM users
        WHERE is_active = TRUE
          AND password_hash IS NULL
      `,
    );

    const remaining = Number(remainingResult.rows[0]?.count ?? 0);

    if (remaining === 0) {
      console.log('\nConfiguración inicial completada.');
      break;
    }

    const continueSetup = await confirm({
      message: `Quedan ${remaining} usuario(s). ¿Configurar otro ahora?`,
      default: true,
    });

    if (!continueSetup) {
      console.log('Podés ejecutar nuevamente el comando para continuar.');
      break;
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && error.name === 'ExitPromptError') {
    console.log('\nConfiguración cancelada.');
  } else {
    console.error(
      '\nNo se pudo completar la configuración:',
      error instanceof Error ? error.message : 'Error desconocido',
    );

    process.exitCode = 1;
  }
} finally {
  await db.end();
}

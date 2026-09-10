/**
 * @file transport.tools.js
 * @description AI Tool definitions and executors for the Transport module (read-only).
 */

import Transport from '../../models/Transport.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

export const transportToolDefinitions = [
  {
    name: 'getTransport',
    description: 'List school transport routes and vehicles.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by route name or vehicle number.' },
      },
    },
  },
];

export const transportToolExecutors = {
  async getTransport(args, context) {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('transport') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((t) =>
          (t.route || t.routeName || '').toLowerCase().includes(term) ||
          (t.vehicleNumber || '').toLowerCase().includes(term)
        );
      }
    } else {
      const filter = args.search
        ? {
            $or: [
              { route: new RegExp(args.search, 'i') },
              { vehicleNumber: new RegExp(args.search, 'i') },
            ],
          }
        : {};
      list = await Transport.find(filter);
    }

    return {
      success: true,
      count: list.length,
      transport: list.map((t) => ({
        id: t._id || t.id,
        route: t.route || t.routeName || '-',
        vehicleNumber: t.vehicleNumber || '-',
        driver: t.driver || t.driverName || '-',
        contact: t.contact || t.driverContact || '-',
        capacity: t.capacity || '-',
      })),
    };
  },
};

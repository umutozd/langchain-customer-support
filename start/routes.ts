/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const UsersController = () => import('#controllers/users_controller')
const CustomerServiceController = () => import('#controllers/customer_services_controller')

router.resource('users', UsersController).apiOnly()
router.post('/customer-service/audios/transcribe', [CustomerServiceController, 'transcribeAudio'])
router.post('/customer-service/chat', [CustomerServiceController, 'chat'])

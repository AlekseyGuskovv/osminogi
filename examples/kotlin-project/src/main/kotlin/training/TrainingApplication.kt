package training

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.web.SecurityFilterChain

@SpringBootApplication
class TrainingApplication {
    @Bean
    fun security(http: HttpSecurity): SecurityFilterChain = http.authorizeHttpRequests {
        it.requestMatchers("/admin/training").hasRole("ADMIN")
        it.anyRequest().authenticated()
    }.build()
}

fun main(args: Array<String>) {
    runApplication<TrainingApplication>(*args)
}